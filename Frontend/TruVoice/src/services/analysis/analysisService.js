import { api } from '../api/client';
import { mapAnalysisResponse } from '../../utils/analysisMapper';

const assertMp3Uri = (uri) => {
  if (!uri) throw new Error('Audio file URI is missing.');
  const str = String(uri);
  const isMp3 =
    /\.mp3($|\?)/i.test(str) || /truvoice_.*\.mp3/i.test(str);
  if (!isMp3) {
    throw new Error('Invalid audio format. Only MP3 files are accepted for analysis.');
  }
};

export const analysisService = {
  analyzeChunk: async (mp3Uri, callerNumber) => {
    assertMp3Uri(mp3Uri);
    if (!callerNumber || !String(callerNumber).trim()) {
      throw new Error('Caller number is required for AI analysis.');
    }
    const response = await api.analyzeAudio(mp3Uri, callerNumber);
    return mapAnalysisResponse(response.data);
  },

  fetchHistory: async () => {
    try {
      const [analysisRes, voiceRes] = await Promise.allSettled([
        api.getAnalysisHistory(),
        api.getVoiceCalls(),
      ]);

      const analysisItems = analysisRes.status === 'fulfilled' ? analysisRes.value.data?.items || [] : [];
      const voiceItems = voiceRes.status === 'fulfilled' ? voiceRes.value.data?.items || [] : [];

      const combined = [
        ...analysisItems,
        ...voiceItems.map((v) => ({
          id: v.id,
          caller_number: v.phone_number || v.caller_number,
          target_user_id: v.target_user_id,
          target_user_name: v.target_user_name || v.caller_name,
          file_name: `Voice Call (${v.duration || 0}s)`,
          transcript: v.transcript,
          ai_voice_probability: v.is_ai_voice ? 90.0 : 10.0,
          scam_intent_score: v.is_scam ? 90.0 : 10.0,
          unified_risk_score: v.risk_level === 'CRITICAL RISK' ? 85.0 : v.risk_level === 'HIGH RISK' ? 70.0 : 15.0,
          risk_level: v.risk_level || 'LOW RISK',
          scam_category: v.is_scam ? 'Voice Scam Alert' : 'Standard Call',
          flagged_keywords: v.signals || [],
          reasoning: v.transcript ? `Call transcript: ${v.transcript.substring(0, 100)}...` : 'Real-time phone call',
          created_at: v.created_at,
          status: v.status || '',
          duration: v.duration || 0,
        })),
      ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      return combined;
    } catch (err) {
      console.warn('Error fetching unified call history:', err);
      const response = await api.getAnalysisHistory();
      return response.data?.items || [];
    }
  },


  checkSpamStatus: async (phoneNumber) => {
    const response = await api.getSpamStatus(phoneNumber);
    return response.data;
  },

  reportSpam: async (phoneNumber) => {
    const response = await api.reportSpam(phoneNumber);
    return response.data;
  },

  submitScamComplaint: async (phoneNumber, description) => {
    const response = await api.submitScamComplaint(phoneNumber, description);
    return response.data;
  },
};

export default analysisService;
