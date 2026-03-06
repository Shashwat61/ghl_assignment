import {
  RoomServiceClient,
  AccessToken,
  EgressClient,
  EncodedFileOutput,
} from 'livekit-server-sdk';
import { config } from '../config';
import { logger } from '../logger';
import * as fs from 'fs';
import * as path from 'path';

class LiveKitService {
  private roomClient: RoomServiceClient;
  private egressClient: EgressClient;

  constructor() {
    const httpUrl = config.livekit.url.replace(/^ws/, 'http');
    this.roomClient = new RoomServiceClient(
      httpUrl,
      config.livekit.apiKey,
      config.livekit.apiSecret,
    );
    this.egressClient = new EgressClient(
      httpUrl,
      config.livekit.apiKey,
      config.livekit.apiSecret,
    );

    // Ensure recordings directory exists
    const recDir = path.resolve(config.livekit.recordingsDir);
    if (!fs.existsSync(recDir)) {
      fs.mkdirSync(recDir, { recursive: true });
    }
  }

  async createRoom(roomName: string, metadata: Record<string, unknown> = {}): Promise<void> {
    await this.roomClient.createRoom({
      name: roomName,
      emptyTimeout: 60, // auto-delete if empty for 60s
      maxParticipants: 2,
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
      ttl: 600, // 10 minutes
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

  async startRoomCompositeEgress(roomName: string): Promise<string> {
    const filename = `${roomName}.mp4`;
    const filepath = path.join(path.resolve(config.livekit.recordingsDir), filename);

    const output = new EncodedFileOutput({
      filepath,
    });

    const egressInfo = await this.egressClient.startRoomCompositeEgress(
      roomName,
      output,
      { audioOnly: true },
    );

    logger.info(`Egress started for room ${roomName}, egressId=${egressInfo.egressId}, file=${filepath}`);
    return egressInfo.egressId;
  }

  async stopEgress(egressId: string): Promise<void> {
    try {
      await this.egressClient.stopEgress(egressId);
      logger.info(`Egress stopped: ${egressId}`);
    } catch (err) {
      logger.warn(`Failed to stop egress ${egressId}`, { error: err });
    }
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
      if (participants.length === 0) return 'empty';
      await new Promise((r) => setTimeout(r, 2000));
    }
    return 'timeout';
  }

  recordingFilename(roomName: string): string {
    return `${roomName}.mp4`;
  }

  recordingPath(roomName: string): string {
    return path.join(path.resolve(config.livekit.recordingsDir), this.recordingFilename(roomName));
  }
}

export const livekitService = new LiveKitService();
