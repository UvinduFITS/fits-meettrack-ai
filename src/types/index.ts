export interface Attendee {
  id: string;
  name: string;
  designation: string;
  company: string;
}

export interface ActionItem {
  task: string;
  owner: string;
  deadline: string;
  priority: 'High' | 'Medium' | 'Low';
}

export interface MeetingSetupData {
  meetingTitle: string;
  clientName: string;
  attendees: Attendee[];
  preparedBy: string;
}

export interface MeetingRecord {
  id?: string;
  meeting_title: string;
  client_name: string;
  attendees: Attendee[];
  prepared_by: string;
  start_time: string;
  end_time: string;
  duration_seconds: number;
  meeting_date: string;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  transcript: string | null;
  agenda: string[] | null;
  summary: string | null;
  key_discussion_points: string[] | null;
  decisions: string[] | null;
  action_items: ActionItem[] | null;
  next_steps: string | null;
  pdf_url: string | null;
  status: 'recording' | 'processing' | 'completed' | 'failed';
  created_by: string;
  created_at?: string;
  updated_at?: string;
}

export interface AudioChunk {
  index: number;
  localPath: string;       // mobile file path (empty string on web)
  storagePath: string | null;
  processed: boolean;
  webBlob?: Blob;          // web only — browser MediaRecorder output
}

export interface ProcessingStatus {
  stage: 'uploading' | 'transcribing' | 'summarizing' | 'generating_pdf' | 'saving' | 'done' | 'error';
  message: string;
  progress: number;
}

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: 'user' | 'admin';
  created_at: string;
}

export type RootStackParamList = {
  Login: undefined;
  Home: undefined;
  MeetingSetup: undefined;
  Recording: { setupData: MeetingSetupData };
  NextSteps: { meetingId: string };
  Processing: { meetingId: string };
  MeetingResult: { meetingId: string };
  MeetingDetails: { meetingId: string };
};
