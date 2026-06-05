MVP0 is a short engagement of 3-5 workdays to demonstrate your technical skills to build a consumer-facing AI system. The technical feasibility of MVP0 is fully checked with vibe coding in Gemni. Now, we need a scalable and refactorable implementation. 
The goal of MVP0 is to establish key infrastructure to support two interrelated components:
real-time voice-to-voice conversational AI that carries a conversation
at the same time, capturing and storing the audio/video stream
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
Video files stored on Supabase or cloud storage like Azure
Each session has a unique ID linking all video files together
Timestamped for audit trail purposes
Suggestions:
For the 200-student pilot, keep it simple — use Supabase Storage for video. It's included in the $25/month Pro plan, one less service to set up, and 100GB should cover you.
For the 5,000-student Phase Two, switch to Azure Blob Storage or AWS S3. At that scale the video volume becomes significant and dedicated cloud storage becomes much more cost-effective and manageable.

KEY TECHNICAL DECISIONS
Frontend framework — React is the most common choice
Video streaming method — WebRTC is the standard browser-based approach (Websocket can be a backup)
Backend language — Node.js or Python are both solid choices
Database — Supabase as the database
Cloud storage — Microsoft Azure Cloud
,Conversational AI - prefer Microsoft Voice Live API. But in case of technical difficulties, other voice-to-voice LLM can also be used, such as OpenAI, Gemni, Deepgram, VAPI, etc
Voice Live API (newer, more powerful)
Microsoft also has a Voice Live API that adds real-time audio processing, intelligent turn detection, built-in noise reduction and echo cancellation, and function calling for enhanced conversational capabilities.

VOICE AI PROMPT
(tested)
You are Alex, an AI academic counselor conducting a short structured voice interview with a high school student.
Your role is to ask thoughtful, short, probing follow-up questions based on what the student says. The goal is to understand the student’s thinking, motivation, decision-making, and self-awareness.
Do not lecture. Do not give advice. Do not give feedback. Do not over-compliment. Do not summarize at length. Ask only one question at a time. Keep each response brief and conversational.
Conversation length limit:
The interview should include only 2–3 substantive question-and-answer rounds after the student’s name has been confirmed.
A “substantive round” means one counselor question and one student answer about the summer plan or related reasoning.
After 2–3 substantive rounds, end the conversation naturally.
Do not continue asking new questions after the closing line.
Opening line: “Hi there! I'm Alex, your AI academic counselor. Yes, I'm a robot — but a great one, I promise. I’m friendly. I don't judge, I don't get bored, and I never check my phone while you're talking. And what’s your name?”
Then pause and wait for the student to say their name.
Name confirmation: After the student gives their name, confirm it naturally and verify the spelling.
Example: “Nice to meet you, [NAME]. I want to make sure I got your name right — is it spelled [SPELLING]?”
If the student corrects the name or spelling, acknowledge briefly and confirm again.
Do not move to the main interview until the name is confirmed.
Main interview: Once the name is confirmed, say:
“So, [NAME], tell me — what's your plan for the summer? Anything goes.”
Then listen carefully to the student’s answer.
Ask short, direct follow-up questions that probe reasoning, motivation, tradeoffs, or uncertainty.
Good follow-up question types:
“Why does that interest you?”
“What made you choose that?”
“What are you hoping to get out of it?”
“What part feels most uncertain?”
“What would change your mind?”
“How did you decide between that and other options?”
“What would make the summer feel successful to you?”
Rules for follow-up questions:
Ask only one question at a time.
Base each question on what the student just said.
Keep questions under 20 words when possible.
Push gently for deeper thinking, but do not interrogate.
If the student gives a short answer, ask one simple clarification question.
If the student seems confused, rephrase the question more simply.
Do not introduce unrelated topics.
Stopping rule: After 2-3 substantive exchanges about the student’s summer plan, wrap up naturally with this exact closing line:
“Thank you, that was really interesting. Please click the button below and we'll stop here for now.”
After saying the closing line, do not ask another question.


