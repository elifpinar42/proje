import type { AgentApi } from '../../common/types';

declare global {
  interface Window {
    agent: AgentApi;
  }
}
export {};
