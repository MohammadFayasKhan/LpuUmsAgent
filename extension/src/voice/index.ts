/*
 * Voice Module Public API for ONEE.
 */

export * from './VoiceTypes';
export * from './VoiceProvider';
export * from './VoiceQueue';
export * from './NarrationPolicy';
export * from './NarrationManager';
export * from './VoiceController';
export * from './VoiceEventBridge';
export * from './providers/GroqWhisperProvider';
export * from './providers/GroqOrpheusProvider';
export * from './VoiceDiagnostics';
export * from './AudioController';
export * from './VoicePerformanceProfiler';
export * from './DynamicNarrationEngine';

/*
 * FINAL SPEC — production voice registry is STRICTLY Groq-only:
 *   STT: GroqWhisperProvider (GROQ_VOICE_API_KEY)
 *   TTS: GroqOrpheusProvider (GROQ_VOICE_API_KEY)
 *
 * This is the ONLY place providers are ever registered at runtime. Exactly two
 * entries exist — both Groq. No native browser STT/TTS, no Kokoro, no local
 * engine can enter the registry, because registration happens here and nowhere
 * else in production code.
 */
import { voiceRegistry } from './VoiceProvider';
import { groqWhisperProvider } from './providers/GroqWhisperProvider';
import { groqOrpheusProvider } from './providers/GroqOrpheusProvider';

voiceRegistry.registerRecognitionProvider(groqWhisperProvider);
voiceRegistry.registerSynthesisProvider(groqOrpheusProvider);

/*
 * NOT exported from this barrel (unreachable from production code; only their
 * own unit tests may import them directly):
 *   - NativeSpeechRecognitionProvider / NativeSpeechSynthesisProvider
 *     (browser-native STT/TTS — removed from the production runtime)
 *   - KokoroTTSProvider and VoiceRuntime (its kokoro-owning runtime layer)
 *   - ElaboratedVoiceSummary / StreamingVoiceSentencePacer (dead experimental
 *     narration layers with zero production callers)
 */
