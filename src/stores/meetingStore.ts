import { create } from 'zustand';
import { MeetingSetupData, ActionItem, AudioChunk, ProcessingStatus } from '../types';

interface MeetingState {
  // Setup data
  setupData: MeetingSetupData | null;

  // Auto-captured during recording
  startTime: Date | null;
  endTime: Date | null;
  durationSeconds: number;
  latitude: number | null;
  longitude: number | null;
  address: string | null;

  // Recording state
  isRecording: boolean;
  recordingElapsedSeconds: number;
  audioChunks: AudioChunk[];

  // Meeting ID (set after DB record created)
  currentMeetingId: string | null;

  // Next steps input
  nextSteps: string;

  // Live STT transcript captured during recording
  liveTranscript: string;

  // AI-generated content
  transcript: string | null;
  agenda: string[] | null;
  keyDiscussionPoints: string[] | null;
  decisions: string[] | null;
  actionItems: ActionItem[] | null;
  summary: string | null;
  pdfUrl: string | null;

  // Processing
  processingStatus: ProcessingStatus | null;

  // Actions
  setSetupData: (data: MeetingSetupData) => void;
  setStartTime: (t: Date) => void;
  setEndTime: (t: Date) => void;
  setLocation: (lat: number, lng: number, addr: string | null) => void;
  setIsRecording: (v: boolean) => void;
  setRecordingElapsed: (s: number) => void;
  addAudioChunk: (chunk: AudioChunk) => void;
  markChunkProcessed: (index: number) => void;
  setChunkStoragePath: (index: number, path: string) => void;
  setCurrentMeetingId: (id: string) => void;
  setNextSteps: (text: string) => void;
  setLiveTranscript: (t: string) => void;
  setTranscript: (t: string) => void;
  setAiResults: (results: {
    agenda: string[];
    keyDiscussionPoints: string[];
    decisions: string[];
    actionItems: ActionItem[];
    summary: string;
  }) => void;
  setPdfUrl: (url: string) => void;
  setProcessingStatus: (status: ProcessingStatus) => void;
  resetMeeting: () => void;
}

const initialState = {
  setupData: null,
  startTime: null,
  endTime: null,
  durationSeconds: 0,
  latitude: null,
  longitude: null,
  address: null,
  isRecording: false,
  recordingElapsedSeconds: 0,
  audioChunks: [] as AudioChunk[],
  currentMeetingId: null,
  nextSteps: '',
  liveTranscript: '',
  transcript: null,
  agenda: null,
  keyDiscussionPoints: null,
  decisions: null,
  actionItems: null,
  summary: null,
  pdfUrl: null,
  processingStatus: null,
};

export const useMeetingStore = create<MeetingState>((set) => ({
  ...initialState,

  setSetupData: (data) => set({ setupData: data }),
  setStartTime: (t) => set({ startTime: t }),
  setEndTime: (t) =>
    set((state) => ({
      endTime: t,
      durationSeconds: state.startTime
        ? Math.floor((t.getTime() - state.startTime.getTime()) / 1000)
        : 0,
    })),
  setLocation: (lat, lng, addr) =>
    set({ latitude: lat, longitude: lng, address: addr }),
  setIsRecording: (v) => set({ isRecording: v }),
  setRecordingElapsed: (s) => set({ recordingElapsedSeconds: s }),
  addAudioChunk: (chunk) =>
    set((state) => ({ audioChunks: [...state.audioChunks, chunk] })),
  markChunkProcessed: (index) =>
    set((state) => ({
      audioChunks: state.audioChunks.map((c) =>
        c.index === index ? { ...c, processed: true } : c
      ),
    })),
  setChunkStoragePath: (index, path) =>
    set((state) => ({
      audioChunks: state.audioChunks.map((c) =>
        c.index === index ? { ...c, storagePath: path } : c
      ),
    })),
  setCurrentMeetingId: (id) => set({ currentMeetingId: id }),
  setNextSteps: (text) => set({ nextSteps: text }),
  setLiveTranscript: (t) => set({ liveTranscript: t }),
  setTranscript: (t) => set({ transcript: t }),
  setAiResults: (results) =>
    set({
      agenda: results.agenda,
      keyDiscussionPoints: results.keyDiscussionPoints,
      decisions: results.decisions,
      actionItems: results.actionItems,
      summary: results.summary,
    }),
  setPdfUrl: (url) => set({ pdfUrl: url }),
  setProcessingStatus: (status) => set({ processingStatus: status }),
  resetMeeting: () => set({ ...initialState, audioChunks: [] }),
}));
