We are buildng a consumer-facing AI system. we need a scalable and refactorable implementation. 
The goal is to establish key infrastructure to support two interrelated components:
1. real-time voice-to-voice conversational AI that carries a conversation
2. capturing and storing the audio/video stream

FRONTEND - Style
Smartphone-first responsive web app, runs in browser, no native app
Built in React or similar modern framework
No login screen — starts to the core function right away
Clean minimal UI optimized for phone screen size
START: AI will start talking whenever the person lands to this page
END: "I'm Done" button to stop recording
DURING: The user sees their own video feed on the screen from the camera

BACKEND
A “Tee” of the audio stream, splitting between AI and the recording system - Please make sure the design has no echoes 
Receives video and audio stream from browser in real time. In the stream, it need to have both the user’s a/v and the AI’s audio questions.
Writes a/v stream to server
Stores session metadata — timestamp, student session ID, stage completion status
No analysis at this stage — just capture and store

VIDEO STORAGE
Video files stored on Supabase or cloud storage like Azure/AWS S3
Each session has a unique ID linking all video files together
Timestamped for audit trail purposes

KEY TECHNICAL DECISIONS
Frontend framework — React is the most common choice
Video streaming method — WebRTC is the standard browser-based approach (Websocket can be a backup)
Backend language — Node.js or Python are both solid choices
Database — Supabase as the database
Cloud storage — AWS s3 
Conversational AI - prefer Microsoft Voice Live API. But in case of technical difficulties, other voice-to-voice LLM can also be used, such as OpenAI, Gemni, Deepgram, VAPI, etc

