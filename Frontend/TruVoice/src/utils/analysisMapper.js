import { formatDateLabel, formatTime } from './formatters';
import { useAuthStore } from '../store/authStore';
import { getRiskScoreColor } from './scoreColors';

const normalizeRiskLevel = (riskLevel = '') => {
  const value = String(riskLevel).toLowerCase();
  if (value.includes('severe') || value.includes('critical') || value.includes('high')) return 'high';
  if (value.includes('medium') || value.includes('moderate')) return 'medium';
  return 'low';
};

const pickEither = (obj, camelKey, snakeKey, fallback = undefined) => {
  if (obj == null) return fallback;
  const camel = obj[camelKey];
  const snake = obj[snakeKey];
  if (camel !== undefined && camel !== null) return camel;
  if (snake !== undefined && snake !== null) return snake;
  return fallback;
};

export const normalizePhoneNumber = (value = '') =>
  String(value).replace(/\D/g, '');

const phoneNumbersMatch = (left, right) => {
  const normalizedLeft = normalizePhoneNumber(left);
  const normalizedRight = normalizePhoneNumber(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;
  if (normalizedLeft.endsWith(normalizedRight) || normalizedRight.endsWith(normalizedLeft)) {
    return true;
  }
  return normalizedLeft.slice(-10) === normalizedRight.slice(-10);
};

const getCallerNumber = (item = {}) =>
  item.callerNumber ?? item.caller_number ?? item.number ?? item.phone_number ?? '';

const isGenericCallerName = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return (
    !normalized ||
    /app[-_ ]?to[-_ ]?app/.test(normalized) ||
    /^(unknown|target|caller)[-_ ]?(caller|user|name)?$/.test(normalized) ||
    /^(target|caller)[-_ ]?user[-_ ]?name$/.test(normalized)
  );
};

export const normalizeAnalysis = (data = {}) => {
  const aiProbability = Math.round(
    pickEither(data, 'aiProbability', 'ai_voice_probability', 0),
  );
  const scamIntent = Math.round(
    pickEither(data, 'scamIntentScore', 'scam_intent_score', 0),
  );
  const unifiedRisk = Math.round(
    pickEither(data, 'unifiedRiskScore', 'unified_risk_score', 0),
  );
  // Trust reflects the whole call: an AI voice or scam intent reduces it.
  // AI probability remains available separately as the voice-model signal.
  const backendTrustScore = pickEither(data, 'trustScore', 'trust_score', null);
  const authenticityScore = Math.max(
    0,
    Math.min(100, Math.round(backendTrustScore ?? (100 - unifiedRisk))),
  );

  const flaggedKeywords =
    pickEither(data, 'flaggedKeywords', 'flagged_keywords') || [];
  const riskEvents = flaggedKeywords.map((keyword, index) => ({
    id: `kw-${index}`,
    time: '--:--',
    label: keyword,
    type: unifiedRisk >= 70 ? 'danger' : 'warning',
  }));

  // The backend returns `transcript` as the Presidio-sanitized value. Prefer
  // `sanitized_transcript` as well so clients remain safe if the API exposes
  // both raw and sanitized values in a future response.
  const transcriptText =
    data.sanitizedTranscript ??
    data.sanitized_transcript ??
    pickEither(data, 'transcript', 'transcript', '') ??
    '';
  const existingLines = pickEither(data, 'transcriptLines', null);
  const transcriptLines =
    Array.isArray(existingLines) && existingLines.length
      ? existingLines
      : transcriptText
          ? transcriptText
              .split('\n')
              .filter(Boolean)
              .map((line, index) => ({
                id: `line-${index}`,
                time: '--:--',
                text: line.trim(),
              }))
          : [];

  const reasoning = pickEither(data, 'reasoning', 'reasoning', '') || '';
  const riskLevelRaw = pickEither(data, 'riskLevelLabel', 'risk_level', 'LOW RISK');
  const createdAt =
    pickEither(data, 'createdAt', 'created_at') || new Date().toISOString();

  return {
    id: pickEither(data, 'id', 'id', null),
    fileName: pickEither(data, 'fileName', 'file_name', ''),
    callerNumber: pickEither(data, 'callerNumber', 'caller_number', ''),
    transcript: transcriptText,
    transcriptLines,
    aiProbability,
    scamIntentScore: scamIntent,
    unifiedRiskScore: unifiedRisk,
    authenticityScore,
    confidence: Math.round(pickEither(data, 'confidence', 'confidence', unifiedRisk)),
    riskLevel: normalizeRiskLevel(riskLevelRaw),
    riskLevelLabel: String(riskLevelRaw || 'SAFE'),
    threatType: pickEither(data, 'threatType', 'threat_type', 'NORMAL') || 'NORMAL',
    uiAlert: pickEither(data, 'uiAlert', 'ui_alert', 'This call looks safe.') || 'This call looks safe.',
    scamCategory: pickEither(data, 'scamCategory', 'scam_category', '') || '',
    flaggedKeywords,
    reasoning,
    analysisReasons: reasoning ? [reasoning] : [],
    riskEvents:
      Array.isArray(data.riskEvents) && data.riskEvents.length
        ? data.riskEvents
        : riskEvents,
    createdAt,
  };
};

export const mapAnalysisResponse = (data = {}) => normalizeAnalysis(data);

export const resolveContactName = (item = {}, contacts = []) => {
  const rawName = pickEither(item, 'name', 'caller_name', 'target_user_name', null);
  const callerNum = getCallerNumber(item);

  const isGeneric =
    isGenericCallerName(rawName) ||
    /app[-_]?to[-_]?app/i.test(String(callerNum)) ||
    phoneNumbersMatch(rawName, callerNum);

  if (!isGeneric && rawName) {
    return rawName.trim();
  }

  // Try matching caller number or ID against contacts store
  if (Array.isArray(contacts) && contacts.length > 0) {
    const match = contacts.find((c) => {
      if (!c) return false;
      const cNum = normalizePhoneNumber(c.number || c.phone_number || c.phone || '');
      return (
        phoneNumbersMatch(callerNum, cNum) ||
        (c.id && String(c.id) === String(callerNum)) ||
        (c.id && item.target_user_id && String(c.id) === String(item.target_user_id))
      );
    });
    if (match && match.name) {
      return match.name;
    }
  }

  if (callerNum && !/app[-_]?to[-_]?app/i.test(String(callerNum))) {
    return callerNum;
  }

  return 'Unknown Caller';
};

export const mapHistoryItem = (item = {}, contacts = []) => {
  const mapped = mapAnalysisResponse(item);
  const createdAtRaw =
    pickEither(item, 'createdAt', 'created_at') || new Date().toISOString();
  const createdAt = new Date(createdAtRaw);
  const callerNum = getCallerNumber(item);
  const resolvedName = resolveContactName(item, contacts);
  const isSavedContact = item.isSavedContact === true || contacts.some((contact) => {
    if (!contact) return false;
    const contactNumber = contact.number || contact.phone_number || contact.phone || '';
    return phoneNumbersMatch(callerNum, contactNumber) || (
      item.caller_name && contact.name &&
      String(item.caller_name).trim().toLowerCase() === String(contact.name).trim().toLowerCase()
    );
  });
  const derivedInitials = resolvedName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'UC';

  const rawStatus = pickEither(item, 'status', 'status', '');
  const isMissed = ['missed', 'no-answer', 'no_answer', 'declined', 'canceled'].includes(
    String(rawStatus).toLowerCase(),
  );

  const currentUser = useAuthStore.getState().user;
  const isIncoming = currentUser && item.target_user_id && String(item.target_user_id) === String(currentUser.id);
  const isOutgoing = !isIncoming;

  let filterCategory = pickEither(item, 'filterCategory', null);
  if (isMissed) {
    filterCategory = 'Missed';
  }

  if (!filterCategory) {
    filterCategory = 'Human';
    if (mapped.aiProbability > 60) filterCategory = 'AI';
    else if (mapped.aiProbability > 30 || mapped.unifiedRiskScore > 50) {
      filterCategory = 'Suspicious';
    }
  }

  const badge =
    pickEither(item, 'badge', null) ||
    (isMissed
      ? (isOutgoing ? 'Not Answered' : 'Missed')
      : mapped.aiProbability > 60
        ? 'AI'
        : mapped.aiProbability > 30
          ? 'Suspicious'
          : 'Human');
  const badgeColor =
    pickEither(item, 'badgeColor', null) ||
    (isMissed
      ? (isOutgoing ? '#71717A' : '#EF4444')
      : getRiskScoreColor(Math.max(mapped.aiProbability, mapped.unifiedRiskScore)));

  const scamCategory = pickEither(item, 'scamCategory', 'scam_category', '') || '';

  return {
    ...mapped,
    isSavedContact,
    analysisAvailable: !isSavedContact,
    id: pickEither(item, 'id', 'id', mapped.id),
    number: pickEither(item, 'number', null, callerNum) || callerNum,
    name: resolvedName,
    initials: derivedInitials,
    time: pickEither(item, 'time', null, formatTime(createdAt)) || formatTime(createdAt),
    dateLabel:
      pickEither(item, 'dateLabel', null, formatDateLabel(createdAt)) ||
      formatDateLabel(createdAt),
    group:
      pickEither(item, 'group', null, formatDateLabel(createdAt)) ||
      formatDateLabel(createdAt),
    duration: pickEither(item, 'duration', null, '--') || '--',
    filterCategory,
    scamCategory: scamCategory || (isMissed ? (isOutgoing ? 'Not Answered' : 'Missed Call') : ''),
    aiExplanation: pickEither(item, 'aiExplanation', null, mapped.reasoning) || mapped.reasoning,
    badge,
    badgeColor,
    status: rawStatus,
  };
};

export const mapAnalysisToStore = (data = {}) => {
  const mapped = mapAnalysisResponse(data);
  return {
    authenticityScore: mapped.authenticityScore,
    aiProbability: mapped.aiProbability,
    confidence: mapped.confidence,
    riskLevel: mapped.riskLevel,
    riskEvents: mapped.riskEvents,
    analysisReasons: mapped.analysisReasons,
    transcript: mapped.transcriptLines,
    lastAnalysis: mapped,
  };
};

export default mapAnalysisResponse;
