import { useEffect, useRef, useCallback } from 'react';
import { ENDPOINTS } from '../constants/config';
import { useAuthStore } from '../store/authStore';
import { useCallStore } from '../store/callStore';
import { useAiDetectionStore } from '../store/aiDetectionStore';

export function useVoiceAnalysis(callId, onAnalysisUpdate) {
  const wsRef = useRef(null);
  const reconnectCountRef = useRef(0);
  const analysisUpdateRef = useRef(onAnalysisUpdate);
  const token = useAuthStore((s) => s.token);

  const setCallData = useCallStore((s) => s.setCallData);
  const setConnectionState = useCallStore((s) => s.setConnectionState);
  const setRiskAlert = useCallStore((s) => s.setRiskAlert);
  const setWebEvidence = useCallStore((s) => s.setWebEvidence);
  const setPendingWebEvidence = useCallStore((s) => s.setPendingWebEvidence);
  const setRiskUpdate = useCallStore((s) => s.setRiskUpdate);

  const updateAiAnalysis = useAiDetectionStore((s) => s.updateAnalysis || s.setAuthenticity);

  useEffect(() => {
    analysisUpdateRef.current = onAnalysisUpdate;
  }, [onAnalysisUpdate]);

  const connect = useCallback(() => {
    if (!callId || !token) return;

    const wsUrl = ENDPOINTS.wsLiveAnalysis(callId, token);
    setConnectionState('connecting');

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnectionState('connected');
        reconnectCountRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'analysis_update') {
            analysisUpdateRef.current?.(data);
            setCallData({
              trustScore: data.trust_score,
              confidence: data.confidence,
              riskLevel: data.risk_level,
              isScam: data.is_scam,
              isAIVoice: data.is_ai_voice,
              threatType: data.threat_type || 'NORMAL',
              uiAlert: data.ui_alert || 'This call looks safe.',
              transcript: data.transcript,
              signals: data.signals || [],
              reasoning: data.reasoning || '',
            });

            // Also sync into aiDetectionStore for full UI component compatibility
            if (typeof updateAiAnalysis === 'function') {
              updateAiAnalysis({
                authenticityScore: data.trust_score,
                aiProbability: data.ai_voice_probability,
                confidence: data.confidence,
                riskLevelLabel: data.risk_level,
                scamIntentScore: data.scam_intent_score,
                unifiedRiskScore: data.unified_risk_score,
                threatType: data.threat_type || 'NORMAL',
                uiAlert: data.ui_alert || 'This call looks safe.',
              });
            }
          } else if (data.type === 'web_evidence_pending' || data.event === 'web_evidence_pending') {
            setPendingWebEvidence(data);
          } else if (data.type === 'web_evidence' || data.event === 'web_evidence') {
            setWebEvidence(data);
          } else if (data.type === 'risk_update' || data.event === 'risk_update') {
            analysisUpdateRef.current?.(data);
            setRiskUpdate(data);
            if (typeof updateAiAnalysis === 'function') {
              updateAiAnalysis({
                authenticityScore: Math.round(Math.max(0, 100 - (data.final_score || 0))),
                riskLevelLabel: data.final_level,
                unifiedRiskScore: data.final_score,
              });
            }
          } else if (data.type === 'risk_alert') {
            setRiskAlert({
              riskLevel: data.risk_level,
              message: data.message,
              timestamp: Date.now(),
            });
          } else if (data.type === 'call_ended') {
            setConnectionState('ended');
          }
        } catch (e) {
          console.warn('Failed to parse WebSocket message:', e);
        }
      };

      ws.onerror = (err) => {
        console.warn('Live analysis WebSocket error:', err);
        setConnectionState('error');
      };

      ws.onclose = () => {
        setConnectionState('disconnected');
        // Safe capped reconnect strategy
        if (reconnectCountRef.current < 3) {
          reconnectCountRef.current += 1;
          setTimeout(() => {
            connect();
          }, 2000 * reconnectCountRef.current);
        }
      };
    } catch (e) {
      console.warn('Failed to establish WebSocket connection:', e);
      setConnectionState('error');
    }
  }, [callId, token, setCallData, setConnectionState, setRiskAlert, updateAiAnalysis]);

  useEffect(() => {
    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return {
    reconnect: connect,
    disconnect: () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    },
  };
}

export default useVoiceAnalysis;
