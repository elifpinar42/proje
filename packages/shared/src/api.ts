import { z } from 'zod';

export const passwordSchema = z
  .string()
  .min(8, 'Şifre en az 8 karakter olmalı')
  .max(128)
  .regex(/[A-Za-z]/, 'Şifre en az bir harf içermeli')
  .regex(/[0-9]/, 'Şifre en az bir rakam içermeli');

export const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Kullanıcı adı en az 3 karakter olmalı')
    .max(32)
    .regex(/^[A-Za-z0-9_.-]+$/, 'Yalnızca harf, rakam, _ . - kullanılabilir'),
  password: passwordSchema,
});
export const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
  totp: z.string().trim().max(32).optional(),
});
export const recoverSchema = z.object({
  username: z.string().trim().min(1).max(64),
  recoveryCode: z.string().trim().min(4).max(64),
  newPassword: passwordSchema,
});

export const sensitivitySchema = z.enum(['low', 'medium', 'high']);
export const settingsSchema = z.object({
  sensitivity: sensitivitySchema,
  screenEnabled: z.boolean(),
  keyboardEnabled: z.boolean(),
  cameraEnabled: z.boolean(),
  micEnabled: z.boolean(),
  notifyParentOnRisk: z.boolean(),
  /** Çocuk bilgisayarı açılınca uygulama kendiliğinden başlasın. */
  autostart: z.boolean().default(true),
  retentionDays: z.number().int().min(1).max(3650),
});
export type ChildSettings = z.infer<typeof settingsSchema>;
export const DEFAULT_SETTINGS: ChildSettings = {
  sensitivity: 'medium',
  screenEnabled: true,
  keyboardEnabled: false,
  cameraEnabled: false,
  micEnabled: false,
  notifyParentOnRisk: true,
  autostart: true,
  retentionDays: 90,
};

export const childCreateSchema = z.object({ name: z.string().trim().min(1).max(40) });
export const unpairSchema = z.object({ code: z.string().trim().regex(/^[0-9]{6}$/, '6 haneli kod gerekli') });
export const pairSchema = z.object({
  code: z.string().trim().regex(/^[0-9]{6}$/, '6 haneli kod gerekli'),
  deviceName: z.string().trim().min(1).max(60).default('Çocuk bilgisayarı'),
});

export const emotionSchema = z.enum([
  'neutral',
  'happy',
  'sad',
  'angry',
  'fearful',
  'disgusted',
  'surprised',
]);
export const eventSchema = z.object({
  occurredAt: z.number().int().optional(),
  title: z.string().max(200),
  details: z.string().max(1000),
  score: z.number().int().min(0).max(100),
  category: z.string().max(100),
  windowTitle: z.string().max(300).default(''),
  emotion: emotionSchema.default('neutral'),
  source: z.enum(['risk', 'chat']).default('risk'),
});
export type AgentEvent = z.infer<typeof eventSchema>;

export const heartbeatSchema = z.object({
  riskScore: z.number().int().min(0).max(100),
  emotion: emotionSchema,
  windowTitle: z.string().max(300).default(''),
  audioLevel: z.number().min(0).max(100).default(0),
  keyboardRisk: z.number().min(0).max(100).default(0),
  expressions: z.record(z.string(), z.number()).optional(),
  /** Bu nabız aralığında cihazın aktif kullanıldığı saniye. */
  activeSeconds: z.number().int().min(0).max(300).default(10),
});
export type Heartbeat = z.infer<typeof heartbeatSchema>;

export const aiConfigSchema = z.object({
  enabled: z.boolean(),
  baseUrl: z.string().url().max(300),
  model: z.string().trim().min(1).max(100),
  /** Boş bırakılırsa mevcut anahtar korunur. */
  apiKey: z.string().max(500).optional(),
});
export type AiConfigInput = z.infer<typeof aiConfigSchema>;

export const chatSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(2000) }))
    .max(20)
    .default([]),
});

export const pdfRequestSchema = z.object({
  childId: z.string().min(1),
  days: z.number().int().min(1).max(365).default(7),
});
