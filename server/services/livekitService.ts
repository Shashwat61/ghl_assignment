import {
  RoomServiceClient,
  AccessToken,
  AgentDispatchClient,
} from 'livekit-server-sdk';
import { Room, RoomEvent, RemoteAudioTrack, AudioStream } from '@livekit/rtc-node';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { logger } from '../logger';

export interface TranscriptTurn {
  role: 'user' | 'assistant';
  content: string;
}

// PCM format fed to ffmpeg: signed 16-bit little-endian, mono, 48kHz
const SAMPLE_RATE = 48_000;
const NUM_CHANNELS = 1;

class LiveKitService {
  private roomClient: RoomServiceClient;
  private dispatchClient: AgentDispatchClient;

  constructor() {
    const httpUrl = config.livekit.url.replace(/^ws/, 'http');
    this.roomClient = new RoomServiceClient(
      httpUrl,
      config.livekit.apiKey,
      config.livekit.apiSecret,
    );
    this.dispatchClient = new AgentDispatchClient(
      httpUrl,
      config.livekit.apiKey,
      config.livekit.apiSecret,
    );

    const recDir = path.resolve(config.livekit.recordingsDir);
    if (!fs.existsSync(recDir)) {
      fs.mkdirSync(recDir, { recursive: true });
    }
  }

  async createRoom(roomName: string, metadata: Record<string, unknown> = {}): Promise<void> {
    await this.roomClient.createRoom({
      name: roomName,
      emptyTimeout: 60,
      maxParticipants: 5,
      metadata: JSON.stringify(metadata),
    });
    logger.info(`LiveKit room created: ${roomName}`);
  }

  async generateToken(
    roomName: string,
    participantName: string,
    opts: { canPublish?: boolean; canSubscribe?: boolean } = {},
  ): Promise<string> {
    const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
      identity: participantName,
      ttl: 600,
    });
    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: opts.canPublish ?? true,
      canSubscribe: opts.canSubscribe ?? true,
      roomRecord: true,
    });
    return at.toJwt() as unknown as string;
  }

  async deleteRoom(roomName: string): Promise<void> {
    try {
      await this.roomClient.deleteRoom(roomName);
      logger.info(`Room deleted: ${roomName}`);
    } catch (err) {
      logger.warn(`Failed to delete room ${roomName}`, { error: err });
    }
  }

  async listParticipants(roomName: string): Promise<string[]> {
    try {
      const participants = await this.roomClient.listParticipants(roomName);
      return participants.map((p) => p.identity);
    } catch {
      return [];
    }
  }

  async waitForParticipants(
    roomName: string,
    expectedCount: number,
    timeoutMs: number = 30_000,
  ): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const participants = await this.listParticipants(roomName);
      if (participants.length >= expectedCount) return true;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  }

  async waitForRoomEmpty(
    roomName: string,
    timeoutMs: number,
  ): Promise<'empty' | 'timeout'> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const participants = await this.listParticipants(roomName);
      const agentParticipants = participants.filter((p) => p !== 'backend-listener');
      if (agentParticipants.length === 0) return 'empty';
      await new Promise((r) => setTimeout(r, 2000));
    }
    return 'timeout';
  }

  async dispatchAgent(roomName: string, agentName: string, metadata?: string): Promise<void> {
    await this.dispatchClient.createDispatch(roomName, agentName, { metadata });
    logger.info(`Dispatched agent "${agentName}" to room ${roomName}`);
  }

  /**
   * Join the room as a silent listener.
   * - Collects transcript data messages (topic: 'transcript') into the returned array.
   * - Subscribes to every remote audio track and pipes raw PCM into ffmpeg to produce
   *   a mixed .ogg recording in config.livekit.recordingsDir.
   *
   * Call stopRecording() when the call ends to flush and close the ffmpeg process.
   * The returned recordingPath is where the file will land (may not exist yet until stopped).
   */
  async joinRoomAsListener(roomName: string): Promise<{
    room: Room;
    transcript: TranscriptTurn[];
    stopRecording: () => Promise<void>;
    recordingPath: string;
  }> {
    const token = await this.generateToken(roomName, 'backend-listener', {
      canPublish: false,
      canSubscribe: true,
    });

    const room = new Room();
    const transcript: TranscriptTurn[] = [];

    // ── transcript collection ────────────────────────────────────────────────
    room.on(RoomEvent.DataReceived, (payload: Uint8Array, _p: any, _k: any, topic?: string) => {
      if (topic !== 'transcript') return;
      try {
        const turn = JSON.parse(Buffer.from(payload).toString('utf8')) as TranscriptTurn;
        if (turn.role && turn.content) {
          transcript.push(turn);
          logger.debug(`Transcript [${turn.role}]: ${turn.content.slice(0, 80)}...`);
        }
      } catch { /* non-fatal */ }
    });

    // ── recording via ffmpeg ─────────────────────────────────────────────────
    const recDir = path.resolve(config.livekit.recordingsDir);
    const filename = `${roomName}.ogg`;
    const recPath = path.join(recDir, filename);

    // ffmpeg reads interleaved signed-16-bit-LE PCM from stdin, encodes to Ogg Vorbis.
    // -y        overwrite output if exists
    // -f s16le  raw PCM input format
    // -ar       sample rate
    // -ac       channels
    // -i pipe:0 read from stdin
    // -c:a libvorbis  encode to Vorbis
    // -q:a 4    quality level (0–10, 4 ≈ ~128 kbps)
    const ffmpeg: ChildProcess = spawn('ffmpeg', [
      '-y',
      '-f', 's16le',
      '-ar', String(SAMPLE_RATE),
      '-ac', String(NUM_CHANNELS),
      '-i', 'pipe:0',
      '-c:a', 'libvorbis',
      '-q:a', '4',
      recPath,
    ], { stdio: ['pipe', 'ignore', 'pipe'] });

    ffmpeg.stderr?.on('data', (d: Buffer) => {
      // ffmpeg logs progress to stderr — only surface errors
      const msg = d.toString();
      if (msg.includes('Error') || msg.includes('error')) {
        logger.warn(`ffmpeg: ${msg.trim()}`);
      }
    });

    ffmpeg.on('close', (code) => {
      logger.info(`ffmpeg exited (code ${code}) — recording: ${recPath}`);
    });

    // Track active AudioStream loops so we can cancel them when done
    const activeStreams: AudioStream[] = [];

    const pipeTrack = (track: RemoteAudioTrack, participantIdentity: string) => {
      const stream = new AudioStream(track, { sampleRate: SAMPLE_RATE, numChannels: NUM_CHANNELS });
      activeStreams.push(stream);
      logger.info(`Recording: subscribing to audio track from ${participantIdentity}`);

      // Async loop — runs until stream closes (track unpublished / room disconnected)
      (async () => {
        try {
          for await (const frame of stream) {
            if (!ffmpeg.stdin?.writable) break;
            // frame.data is Int16Array — write the underlying ArrayBuffer as bytes
            const buf = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
            ffmpeg.stdin.write(buf);
          }
        } catch {
          // Stream ended — normal on room disconnect
        }
      })();
    };

    // Subscribe to already-present audio tracks (in case tracks published before we joined)
    for (const [, participant] of room.remoteParticipants) {
      for (const [, pub] of participant.trackPublications) {
        if (pub.track instanceof RemoteAudioTrack) {
          pipeTrack(pub.track, participant.identity);
        }
      }
    }

    // Subscribe to future tracks
    room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
      if (track instanceof RemoteAudioTrack) {
        pipeTrack(track, participant.identity);
      }
    });

    await room.connect(config.livekit.url, token);
    logger.info(`Backend listener joined room: ${roomName}, recording → ${recPath}`);

    const stopRecording = async (): Promise<void> => {
      // Close ffmpeg stdin — signals EOF, triggers file finalisation
      await new Promise<void>((resolve) => {
        if (!ffmpeg.stdin || ffmpeg.killed) { resolve(); return; }
        ffmpeg.stdin.end(() => resolve());
      });
      // Give ffmpeg up to 5s to flush and write the file trailer
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 5_000);
        ffmpeg.on('close', () => { clearTimeout(t); resolve(); });
      });
    };

    return { room, transcript, stopRecording, recordingPath: recPath };
  }

  recordingFilename(roomName: string): string {
    return `${roomName}.ogg`;
  }

  recordingPath(roomName: string): string {
    return path.join(path.resolve(config.livekit.recordingsDir), this.recordingFilename(roomName));
  }
}

export const livekitService = new LiveKitService();
