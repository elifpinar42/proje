import { contextBridge, ipcRenderer } from 'electron';
import type { AgentApi, AppState, Guidance } from '../common/types';

const api: AgentApi = {
  getState: () => ipcRenderer.invoke('agent:getState'),
  onState(cb) {
    const handler = (_: unknown, s: AppState) => cb(s);
    ipcRenderer.on('agent:state', handler);
    return () => ipcRenderer.removeListener('agent:state', handler);
  },
  onGuidance(cb) {
    const handler = (_: unknown, g: Guidance) => cb(g);
    ipcRenderer.on('agent:guidance', handler);
    return () => ipcRenderer.removeListener('agent:guidance', handler);
  },
  pair: (req) => ipcRenderer.invoke('agent:pair', req),
  acceptConsent: () => ipcRenderer.invoke('agent:acceptConsent'),
  unpair: () => ipcRenderer.invoke('agent:unpair'),
  sendEmotion: (p) => ipcRenderer.send('agent:emotion', p),
  sendAudioLevel: (level) => ipcRenderer.send('agent:audio', level),
  chat: (message, history) => ipcRenderer.invoke('agent:chat', message, history),
  mediaStatus: () => ipcRenderer.invoke('agent:mediaStatus'),
  openPrivacy: (kind) => ipcRenderer.invoke('agent:openPrivacy', kind),
  openPanel: () => ipcRenderer.invoke('agent:openPanel'),
  setAutostart: (enabled) => ipcRenderer.invoke('agent:setAutostart', enabled),
  setLanAccess: (enabled) => ipcRenderer.invoke('agent:setLanAccess', enabled),
  devSimulate: (kind) => ipcRenderer.invoke('agent:devSimulate', kind),
};

contextBridge.exposeInMainWorld('agent', api);
