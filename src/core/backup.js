/**
 * 账号池与配置加密备份 —— 基于标准 Web Crypto（PBKDF2-SHA256 + AES-GCM），零外部依赖。
 *
 * 导出内容只包含脱敏校验后的凭据与设置，口令绝不落盘；导入采用安全合并而非粗暴覆盖。
 */

const FORMAT = 'bili-toolkit-backup';
const VERSION = 1;
const PBKDF2_ITERATIONS = 120000;

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromBase64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function subtleCrypto() {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  if (!c || !c.subtle || !c.getRandomValues) {
    throw new Error('当前环境不支持 Web Crypto 加密接口');
  }
  return c;
}

async function deriveKey(password, salt, usage) {
  const c = subtleCrypto();
  const enc = new TextEncoder();
  const baseKey = await c.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return c.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage]
  );
}

/**
 * 加密 payload 为标准 JSON 文本。
 * @param {object} payload
 * @param {string} password
 * @returns {Promise<string>}
 */
export async function encryptBackup(payload, password) {
  const pwd = String(password || '');
  if (pwd.length < 4) throw new Error('口令长度至少 4 位');
  const c = subtleCrypto();
  const salt = c.getRandomValues(new Uint8Array(16));
  const iv = c.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pwd, salt, 'encrypt');
  const plain = new TextEncoder().encode(JSON.stringify(payload));
  const cipher = new Uint8Array(await c.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  return JSON.stringify(
    {
      format: FORMAT,
      v: VERSION,
      kdf: 'PBKDF2-SHA256',
      iter: PBKDF2_ITERATIONS,
      alg: 'AES-GCM',
      salt: toBase64(salt),
      iv: toBase64(iv),
      data: toBase64(cipher)
    },
    null,
    2
  );
}

/**
 * 解密备份 JSON 文本。
 * @param {string} rawText
 * @param {string} password
 * @returns {Promise<object>}
 */
export async function decryptBackup(rawText, password) {
  const pwd = String(password || '');
  if (!pwd) throw new Error('请输入备份口令');
  let env;
  try {
    env = JSON.parse(String(rawText || '').trim());
  } catch {
    throw new Error('备份文件不是有效的 JSON 格式');
  }
  if (!env || env.format !== FORMAT || env.v !== VERSION || !env.salt || !env.iv || !env.data) {
    throw new Error('备份格式不匹配或已损坏');
  }
  const c = subtleCrypto();
  const salt = fromBase64(env.salt);
  const iv = fromBase64(env.iv);
  const cipher = fromBase64(env.data);
  const key = await deriveKey(pwd, salt, 'decrypt');
  let plainBuf;
  try {
    plainBuf = await c.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  } catch {
    throw new Error('口令错误或备份内容已被篡改');
  }
  const parsed = JSON.parse(new TextDecoder().decode(plainBuf));
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.accounts)) {
    throw new Error('备份数据结构无效');
  }
  return parsed;
}
