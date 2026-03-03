import type { IncomingMessage, AgentResponse } from '../types.js';

/**
 * Channel adapter interface — each messaging platform implements this.
 * The agent doesn't know or care which channel is being used.
 */
export interface ChannelAdapter {
  /** Start listening for messages */
  start(): Promise<void>;

  /** Stop listening */
  stop(): Promise<void>;

  /** Send a response back to a user */
  sendResponse(channelUserId: string, response: AgentResponse): Promise<void>;
}
