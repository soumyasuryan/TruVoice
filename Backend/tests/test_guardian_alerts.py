import asyncio
import json
import re
import sys
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

root_dir = Path(__file__).resolve().parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from fastapi import HTTPException
from pydantic import ValidationError

from app.routers import guardian_alerts
from app.schemas import ElderlyModeUpdate, GuardianContactCreate
from app.services import guardian_alert_service as service
from app.services import streaming_service
from app.services.guardian_alert_service import SevereWindowGate


class FakeResult:
    def __init__(self, data):
        self.data = data


class DuplicateAlertError(Exception):
    code = "23505"


class FakeQuery:
    def __init__(self, database, table):
        self.database = database
        self.table_name = table
        self.action = "select"
        self.columns = "*"
        self.filters = []
        self.in_filters = []
        self.values = None
        self.row_limit = None
        self.order_field = None
        self.descending = False

    def select(self, columns="*"):
        self.action = "select"
        self.columns = columns
        return self

    def insert(self, values):
        self.action = "insert"
        self.values = values
        return self

    def update(self, values):
        self.action = "update"
        self.values = values
        return self

    def eq(self, field, value):
        self.filters.append((field, value))
        return self

    def in_(self, field, values):
        self.in_filters.append((field, values))
        return self

    def limit(self, count):
        self.row_limit = count
        return self

    def order(self, field, desc=False):
        self.order_field = field
        self.descending = desc
        return self

    def execute(self):
        rows = self.database.tables.setdefault(self.table_name, [])
        matched = [
            row for row in rows
            if all(row.get(field) == value for field, value in self.filters)
            and all(row.get(field) in values for field, values in self.in_filters)
        ]

        if self.action == "insert":
            incoming = self.values if isinstance(self.values, list) else [self.values]
            inserted = []
            for values in incoming:
                row = dict(values)
                if self.table_name == "guardian_alerts" and any(
                    existing.get("call_id") == row.get("call_id") for existing in rows
                ):
                    raise DuplicateAlertError("duplicate key value violates unique constraint 23505")
                row.setdefault("id", f"{self.table_name}-{len(rows) + 1}")
                rows.append(row)
                inserted.append(dict(row))
            return FakeResult(inserted)

        if self.action == "update":
            for row in matched:
                row.update(self.values)
            return FakeResult([dict(row) for row in matched])

        if self.order_field:
            matched.sort(
                key=lambda row: row.get(self.order_field) or "",
                reverse=self.descending,
            )
        if self.row_limit is not None:
            matched = matched[: self.row_limit]
        if self.columns != "*":
            fields = self.columns.split(",")
            matched = [{field: row.get(field) for field in fields} for row in matched]
        return FakeResult([dict(row) for row in matched])


class FakeDatabase:
    def __init__(self):
        self.tables = {
            "users": [{"id": "user-1", "elderly_mode_enabled": True}],
            "voice_calls": [{"id": "call-1", "user_id": "user-1"}],
            "guardian_contacts": [],
            "guardian_alerts": [],
            "guardian_alert_deliveries": [],
        }

    def table(self, name):
        return FakeQuery(self, name)


class TestSevereWindowGate(unittest.TestCase):
    def test_requires_two_consecutive_severe_windows_and_only_fires_once(self):
        gate = SevereWindowGate()
        self.assertFalse(gate.observe("MODERATE"))
        self.assertFalse(gate.observe("SEVERE"))
        self.assertFalse(gate.observe("SAFE"))
        self.assertFalse(gate.observe("SEVERE"))
        self.assertTrue(gate.observe("SEVERE"))
        self.assertFalse(gate.observe("SEVERE"))


class TestStreamingGuardianScheduling(unittest.IsolatedAsyncioTestCase):
    async def test_only_two_consecutive_severe_windows_schedule_a_nonblocking_task(self):
        levels = iter(("SEVERE", "MODERATE", "SEVERE", "SEVERE"))

        class FakePipeline:
            def analyze_audio_sample(self, _path):
                risk_level = next(levels)
                return {
                    "risk_level": risk_level,
                    "transcript": "",
                    "flagged_keywords": [],
                    "unified_risk_score": 90,
                    "scam_intent_score": 80,
                    "ai_voice_probability": 75,
                    "reasoning": "The caller claims to represent a bank.",
                }

        started = asyncio.Event()
        never_finish = asyncio.Event()

        async def slow_dispatch(*_args):
            started.set()
            await never_finish.wait()

        session = streaming_service.VoiceStreamSession("call-stream-test")
        session._update_call_record_db = Mock()
        with (
            patch.object(streaming_service, "get_pipeline", return_value=FakePipeline()),
            patch.object(streaming_service.manager, "broadcast_to_call", new=AsyncMock()),
            patch.object(
                streaming_service,
                "dispatch_guardian_alert",
                new=AsyncMock(side_effect=slow_dispatch),
            ) as dispatch,
        ):
            for _ in range(3):
                await session.process_audio_chunk(b"\xff" * 8000)
            dispatch.assert_not_awaited()

            await session.process_audio_chunk(b"\xff" * 8000)
            await asyncio.wait_for(started.wait(), timeout=1)
            dispatch.assert_awaited_once()

            tasks = list(streaming_service._guardian_alert_tasks)
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)


class TestGuardianSettingsAndContacts(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self.get_db = patch.object(guardian_alerts, "get_supabase", return_value=self.db)
        self.get_db.start()
        self.send_email = patch.object(guardian_alerts, "send_email")
        self.mock_send_email = self.send_email.start()
        self.addCleanup(self.get_db.stop)
        self.addCleanup(self.send_email.stop)

    def test_elderly_mode_setting_is_persisted(self):
        self.assertFalse(guardian_alerts.update_guardian_settings(ElderlyModeUpdate(enabled=False), "user-1")["enabled"])
        self.assertFalse(guardian_alerts.get_guardian_settings("user-1")["enabled"])
        self.assertTrue(guardian_alerts.update_guardian_settings(ElderlyModeUpdate(enabled=True), "user-1")["enabled"])
        self.assertTrue(guardian_alerts.get_guardian_settings("user-1")["enabled"])

    def test_email_validation_and_limit(self):
        with self.assertRaises(ValidationError):
            GuardianContactCreate(email="invalid-email")
        self.assertEqual(guardian_alerts.add_guardian_contact(GuardianContactCreate(email="one@example.com"), "user-1")["status"], "verified")

        self.db.tables["guardian_contacts"] = [
            {"id": f"contact-{index}", "user_id": "user-1", "email": f"{index}@example.com", "status": "verified", "is_active": True}
            for index in range(service.MAX_CONTACTS)
        ]
        with self.assertRaises(HTTPException) as error:
            guardian_alerts.add_guardian_contact(GuardianContactCreate(email="sixth@example.com"), "user-1")
        self.assertEqual(error.exception.status_code, 409)

    def test_contact_verification_removal_and_opt_out(self):
        result = guardian_alerts.add_guardian_contact(GuardianContactCreate(email="guardian@example.com"), "user-1")
        self.assertEqual(result["status"], "verified")
        text_body = self.mock_send_email.call_args.args[2]
        self.assertIn("added as a trusted guardian contact", text_body.lower())
        self.assertIn("no email verification is required", text_body.lower())
        self.assertIn("unsubscribe", text_body.lower())
        contact = self.db.tables["guardian_contacts"][0]
        self.assertEqual(contact["status"], "verified")
        self.assertIsNone(contact["verification_token_hash"])

        guardian_alerts.remove_guardian_contact(contact["id"], "user-1")
        self.assertFalse(contact["is_active"])
        self.assertEqual(contact["status"], "removed")

        contact["is_active"] = True
        contact["status"] = "verified"
        unsubscribe = service.create_unsubscribe_token(contact["id"], contact["verified_at"])
        response = guardian_alerts.unsubscribe_guardian_contact(contact["id"], unsubscribe)
        self.assertIn("Unsubscribed", response.body.decode())
        self.assertFalse(contact["is_active"])
        self.assertEqual(contact["status"], "opted_out")

    def test_legacy_verify_guardian_contact(self):
        token = "test-verification-token-string"
        self.db.tables["guardian_contacts"] = [
            {
                "id": "contact-pending",
                "user_id": "user-1",
                "email": "legacy@example.com",
                "status": "pending",
                "is_active": True,
                "verification_token_hash": service.hash_verification_token(token),
                "verification_expires_at": "2099-01-01T00:00:00+00:00",
                "verified_at": None,
            }
        ]
        verification = guardian_alerts.verify_guardian_contact(token)
        self.assertIn("Email verified", verification.body.decode())
        self.assertEqual(self.db.tables["guardian_contacts"][0]["status"], "verified")


class TestGuardianAlertDispatch(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self.db.tables["guardian_contacts"] = [
            {
                "id": "contact-1",
                "user_id": "user-1",
                "email": "guardian@example.com",
                "status": "verified",
                "is_active": True,
                "verified_at": "2026-10-13T00:00:00+00:00",
            }
        ]
        self.get_db = patch.object(service, "get_supabase", return_value=self.db)
        self.send_email = patch.object(service, "send_email", return_value=None)
        self.generate_summary = patch.object(
            service,
            "generate_alert_summary",
            new=AsyncMock(return_value="A severe scam risk was detected."),
        )
        self.get_db.start()
        self.mock_send_email = self.send_email.start()
        self.generate_summary.start()
        self.addAsyncCleanup(self.get_db.stop)
        self.addAsyncCleanup(self.send_email.stop)
        self.addAsyncCleanup(self.generate_summary.stop)
        self.analysis = {
            "risk_level": "SEVERE",
            "unified_risk_score": 94.2,
            "scam_intent_score": 88.0,
            "ai_voice_probability": 81.0,
            "scam_category": "Bank OTP fraud",
            "threat_type": "SUSPICIOUS_CALLER",
            "flagged_keywords": ["OTP", "account blocked"],
            "reasoning": "The caller claims to represent a bank and requests an OTP.",
            "transcript": "Never send the raw transcript to the guardian email generator.",
        }

    async def test_moderate_mode_off_and_unverified_contacts_send_nothing(self):
        await service.dispatch_guardian_alert("call-1", {**self.analysis, "risk_level": "MODERATE"})
        self.db.tables["users"][0]["elderly_mode_enabled"] = False
        await service.dispatch_guardian_alert("call-1", self.analysis)
        self.db.tables["users"][0]["elderly_mode_enabled"] = True
        self.db.tables["guardian_contacts"][0]["status"] = "pending"
        await service.dispatch_guardian_alert("call-1", self.analysis)
        self.assertEqual(self.db.tables["guardian_alerts"], [])
        self.mock_send_email.assert_not_called()

    async def test_severe_dispatch_is_deduplicated_on_retry(self):
        await service.dispatch_guardian_alert("call-1", self.analysis)
        await service.dispatch_guardian_alert("call-1", self.analysis)
        self.assertEqual(len(self.db.tables["guardian_alerts"]), 1)
        self.assertEqual(len(self.db.tables["guardian_alert_deliveries"]), 1)
        self.mock_send_email.assert_called_once()
        self.assertIn("unsubscribe", self.mock_send_email.call_args.args[2].lower())

    async def test_callee_guardians_receive_alert_when_only_callee_enabled_mode(self):
        self.db.tables["voice_calls"][0]["target_user_id"] = "user-2"
        self.db.tables["users"][0]["elderly_mode_enabled"] = False
        self.db.tables["users"].append(
            {"id": "user-2", "elderly_mode_enabled": True}
        )
        self.db.tables["guardian_contacts"][0]["user_id"] = "user-2"

        await service.dispatch_guardian_alert("call-1", self.analysis)

        self.assertEqual(self.db.tables["guardian_alerts"][0]["user_id"], "user-2")
        self.mock_send_email.assert_called_once()

    async def test_removed_and_opted_out_contacts_are_not_alert_targets(self):
        for status in ("removed", "opted_out"):
            with self.subTest(status=status):
                self.db.tables["guardian_alerts"].clear()
                self.db.tables["guardian_alert_deliveries"].clear()
                self.db.tables["guardian_contacts"][0]["status"] = status
                self.db.tables["guardian_contacts"][0]["is_active"] = False
                await service.dispatch_guardian_alert("call-1", self.analysis)
                self.assertEqual(self.db.tables["guardian_alerts"], [])
        self.mock_send_email.assert_not_called()

    async def test_email_generation_uses_valid_output_and_falls_back_on_bad_output(self):
        def mock_groq_output(content):
            create = AsyncMock(
                return_value=SimpleNamespace(
                    choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
                )
            )
            client = SimpleNamespace(
                chat=SimpleNamespace(completions=SimpleNamespace(create=create))
            )
            return patch.object(service, "AsyncGroq", return_value=client)

        fields = service.build_sanitized_alert_fields(self.analysis)
        self.generate_summary.stop()
        try:
            with patch.object(service.settings, "GROQ_API_KEY", "test-key"):
                valid_patch = mock_groq_output("The caller claimed to represent a bank and requested an OTP.")
                with valid_patch as groq_constructor:
                    self.assertEqual(
                        await service.generate_alert_summary(fields),
                        "The caller claimed to represent a bank and requested an OTP.",
                    )
                    request_body = json.loads(
                        groq_constructor.return_value.chat.completions.create.call_args.kwargs[
                            "messages"
                        ][1]["content"]
                    )
                    self.assertNotIn("transcript", request_body)

                for output in (
                    "https://unsafe.example",
                    "x" * (service.MAX_MESSAGE_LENGTH + 1),
                ):
                    with self.subTest(output=output[:24]):
                        invalid_patch = mock_groq_output(output)
                        with invalid_patch:
                            self.assertEqual(
                                await service.generate_alert_summary(fields),
                                service.fallback_alert_summary(fields),
                            )

                for failure in (asyncio.TimeoutError(), RuntimeError("provider error")):
                    with self.subTest(failure=type(failure).__name__):
                        client = SimpleNamespace(
                            chat=SimpleNamespace(
                                completions=SimpleNamespace(create=AsyncMock(side_effect=failure))
                            )
                        )
                        with patch.object(service, "AsyncGroq", return_value=client):
                            self.assertEqual(
                                await service.generate_alert_summary(fields),
                                service.fallback_alert_summary(fields),
                            )
        finally:
            self.generate_summary.start()

    async def test_failed_contact_retries_and_does_not_stop_other_contacts(self):
        self.db.tables["guardian_contacts"].append(
            {
                "id": "contact-2",
                "user_id": "user-1",
                "email": "second@example.com",
                "status": "verified",
                "is_active": True,
                "verified_at": "2026-10-13T00:00:00+00:00",
            }
        )
        def smtp_side_effect(email, *_args):
            if email == "guardian@example.com":
                raise RuntimeError("SMTP unavailable")

        self.mock_send_email.side_effect = smtp_side_effect
        retry_sleep = AsyncMock()
        with patch.object(service.asyncio, "sleep", new=retry_sleep):
            with self.assertLogs(service.logger, level="WARNING") as logs:
                await service.dispatch_guardian_alert("call-1", self.analysis)

        statuses = {
            delivery["contact_id"]: (delivery["status"], delivery["attempts"])
            for delivery in self.db.tables["guardian_alert_deliveries"]
        }
        self.assertEqual(statuses["contact-1"], ("failed", 3))
        self.assertEqual(statuses["contact-2"], ("sent", 1))
        self.assertTrue(any("SMTP unavailable" in record for record in logs.output))
        self.assertEqual(self.mock_send_email.call_count, 4)
        self.assertEqual(
            retry_sleep.await_args_list,
            [unittest.mock.call(1), unittest.mock.call(3)],
        )


if __name__ == "__main__":
    unittest.main()
