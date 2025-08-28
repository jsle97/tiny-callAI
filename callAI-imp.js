import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnv() {
 const envPath = path.resolve(__dirname, '.env');
 if (!fs.existsSync(envPath)) return;
 const envContent = fs.readFileSync(envPath, 'utf8');
 const lines = envContent.split('\n');
 for (const line of lines) {
  if (!line || line.startsWith('#')) continue;
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length > 0) {
   const value = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
   process.env[key.trim()] = value;
  }
 }
}

loadEnv();

let customModelsLoaded = false;

async function loadCustomModels() {
 if (customModelsLoaded) return;
 try {
  const customModelsPath = path.resolve(__dirname, '_models.js');
  if (fs.existsSync(customModelsPath)) {
   const module = await import(customModelsPath);
   if (module._MODELS) {
    for (const [provider, models] of Object.entries(module._MODELS)) {
     if (AI_PROVIDERS[provider]) Object.assign(AI_PROVIDERS[provider].models, models);
    }
   }
  }
 } catch (e) {
  console.warn('Warning: Failed to load _models.js:', e.message);
 }
 customModelsLoaded = true;
}

const _DEFAULT = { temperature: 0.7, maxTokens: 4096, model: 'mistral-small' };

const VISION_MODELS = {
 openai: ['gpt-4o','gpt-4.1','gpt-5'],
 mistral: ['mistral-small','mistral-medium','mistral-large'],
 together: ['google/gemma-3n-E4B-it']
};

function detectImageFormat(buffer) {
 if (!Buffer.isBuffer(buffer) || buffer.length < 4) return 'image/jpeg';
 if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
 if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'image/png';
 if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
  if (buffer.length > 12 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'image/webp';
 }
 if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif';
 return 'image/jpeg';
}

function isVisionRequest(messages) {
 return messages.some(msg => Array.isArray(msg.content) && msg.content.some(item => item.type === 'image' || item.type === 'image_url'));
}

function processImageContent(content) {
 if (Buffer.isBuffer(content)) {
  const base64 = content.toString('base64');
  const mimeType = detectImageFormat(content);
  return `data:${mimeType};base64,${base64}`;
 }
 if (typeof content === 'string' && !content.startsWith('data:') && !/^https?:\/\//i.test(content)) {
  return `data:image/jpeg;base64,${content}`;
 }
 return content;
}

function supportsVision(provider, model) {
 const models = VISION_MODELS[provider];
 if (!models) return false;
 return models === 'all' || (Array.isArray(models) && models.includes(model));
}

function normalizeContent(content) {
 if (typeof content === 'string') return [{ type: 'text', text: content }];
 if (Array.isArray(content)) {
  return content.map(item => {
   if (typeof item === 'string') return { type: 'text', text: item };
   if (item.type === 'image' && item.url !== undefined) return { type: 'image', url: processImageContent(item.url) };
   if (item.type === 'image_url' && item.image_url?.url !== undefined) return { type: 'image_url', image_url: { url: processImageContent(item.image_url.url) } };
   return item;
  });
 }
 return [{ type: 'text', text: String(content || '') }];
}

const AI_PROVIDERS = {
 openai: {
  apiKey: process.env.OPENAI_API_KEY || '',
  baseUrl: 'https://api.openai.com/v1/chat/completions',
  models: {
   'gpt-4o': { name: 'gpt-4o', cost: { in: 2.5, out: 10 } },
   'gpt-4.1': { name: 'gpt-4.1', cost: { in: 2, out: 8 } },
   'gpt-5': { name: 'gpt-5', cost: { in: 1.25, out: 10 } }
  },
  formatPayload: (messages, model, maxTokens, options = {}) => {
   const isVision = isVisionRequest(messages);
   let processedMessages = messages;
   if (isVision) {
    processedMessages = messages.map(msg => {
     if (Array.isArray(msg.content)) {
      return { ...msg, content: msg.content.map(item => item.type === 'image' ? { type: 'image_url', image_url: { url: processImageContent(item.url) } } : item) };
     }
     return msg;
    });
   }
   const payload = { model, messages: processedMessages, temperature: options.temperature || _DEFAULT.temperature };
   if (/^gpt-(5|4)/.test(model)) {
    payload.max_completion_tokens = maxTokens || _DEFAULT.maxTokens;
    payload.temperature = 1;
   } else {
    payload.max_tokens = maxTokens || _DEFAULT.maxTokens;
   }
   return payload;
  },
  extractResponse: (data) => data.choices?.[0]?.message?.content ?? ''
 },

 mistral: {
  apiKey: process.env.MISTRAL_API_KEY || '',
  baseUrl: 'https://api.mistral.ai/v1/chat/completions',
  models: {
   'mistral-large': { name: 'mistral-large-latest', cost: { in: 2, out: 6 } },
   'mistral-medium': { name: 'mistral-medium-latest', cost: { in: 0.4, out: 2 } },
   'mistral-small': { name: 'mistral-small-2506', cost: { in: 0.1, out: 0.3 } }
  },
  formatPayload: (messages, model, maxTokens, options = {}) => {
   const isVision = isVisionRequest(messages);
   let processedMessages = messages;
   if (isVision) {
    processedMessages = messages.map(msg => {
     if (Array.isArray(msg.content)) {
      return { ...msg, content: msg.content.map(item => item.type === 'image' ? { type: 'image_url', image_url: { url: processImageContent(item.url) } } : item) };
     }
     return msg;
    });
   }
   return { model, messages: processedMessages, max_tokens: maxTokens || _DEFAULT.maxTokens, temperature: options.temperature || _DEFAULT.temperature };
  },
  extractResponse: (data) => data.choices?.[0]?.message?.content ?? ''
 },

 together: {
  apiKey: process.env.TOGETHER_API_KEY || '',
  baseUrl: 'https://api.together.xyz/v1/chat/completions',
  models: {
   'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8': { name: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8', cost: { in: 0.5, out: 2 } },
   'meta-llama/Llama-4-Scout-17B-16E-Instruct': { name: 'meta-llama/Llama-4-Scout-17B-16E-Instruct', cost: { in: 0.4, out: 1.6 } },
   'openai/gpt-oss-20b': { name: 'openai/gpt-oss-20b', cost: { in: 0.3, out: 1.2 } },
   'openai/gpt-oss-120b': { name: 'openai/gpt-oss-120b', cost: { in: 0.3, out: 1.2 } },
   'google/gemma-3n-E4B-it': { name: 'google/gemma-3n-E4B-it', cost: { in: 0.1, out: 0.4 } } 
  },
  formatPayload: (messages, model, maxTokens, options = {}) => {
   const converted = [];
   for (const msg of messages) {
    if (!msg || !msg.role) continue;
    if (Array.isArray(msg.content)) {
     const parts = msg.content.map(item => {
      if (item.type === 'text') return { type: 'text', text: item.text };
      if (item.type === 'image_url' && item.image_url?.url) return { type: 'image_url', image_url: { url: processImageContent(item.image_url.url) } };
      if (item.type === 'image' && item.url) return { type: 'image_url', image_url: { url: processImageContent(item.url) } };
      if (item.type === 'image' && item.data) return { type: 'image_url', image_url: { url: processImageContent(item.data) } };
      return { type: 'text', text: String(item.text ?? item) };
     });
     converted.push({ role: msg.role, content: parts });
    } else if (typeof msg.content === 'string') {
     converted.push({ role: msg.role, content: [{ type: 'text', text: msg.content }] });
    } else {
     converted.push(msg);
    }
   }
   const payload = { model, messages: converted, temperature: options.temperature || _DEFAULT.temperature, max_tokens: maxTokens || _DEFAULT.maxTokens };
   if (options.tools) payload.tools = options.tools;
   if (options.stream) payload.stream = options.stream;
   return payload;
  },
  extractResponse: (data) => {
   if (data.choices && data.choices[0] && data.choices[0].message) return data.choices[0].message.content;
   if (typeof data.output === 'string') return data.output;
   return '';
  }
 }
};

function findProviderForModel(model) {
 for (const [providerName, providerConfig] of Object.entries(AI_PROVIDERS)) {
  if (providerConfig.models[model]) return providerName;
 }
 return null;
}

function normalizeUsage(provider, usage, messages, responseText) {
 if (!usage) {
  const promptChars = messages.reduce((sum, msg) => {
   if (typeof msg.content === 'string') return sum + msg.content.length;
   if (Array.isArray(msg.content)) {
    return sum + msg.content.reduce((s, item) => {
     if (item.type === 'text') return s + (item.text?.length || 0);
     if (item.type === 'image' || item.type === 'image_url') return s + 1000;
     return s;
    }, 0);
   }
   return sum;
  }, 0);
  const completionChars = responseText?.length || 0;
  return {
   prompt_tokens: Math.ceil(promptChars / 3.75),
   completion_tokens: Math.ceil(completionChars / 3.75),
   total_tokens: Math.ceil((promptChars + completionChars) / 3.75)
  };
 }
 return {
  prompt_tokens: usage.prompt_tokens || usage.input_tokens || 0,
  completion_tokens: usage.completion_tokens || usage.output_tokens || 0,
  total_tokens: usage.total_tokens || ((usage.prompt_tokens || usage.input_tokens || 0) + (usage.completion_tokens || usage.output_tokens || 0))
 };
}

async function makeRequest(url, data, headers, timeout = 480000) {
 return new Promise((resolve, reject) => {
  const urlObj = new URL(url);
  const options = {
   hostname: urlObj.hostname,
   port: urlObj.port || 443,
   path: urlObj.pathname + urlObj.search,
   method: 'POST',
   headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(JSON.stringify(data)), ...headers },
   timeout
  };
  const req = https.request(options, (res) => {
   let body = '';
   res.on('data', chunk => body += chunk);
   res.on('end', () => {
    if (!body || body.trim() === '') {
     reject(new Error(`Empty response from API (status: ${res.statusCode})`));
     return;
    }
    try {
     const parsed = JSON.parse(body);
     if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
     else {
      const errorMsg = parsed.error?.message || parsed.message || body.substring(0, 200);
      reject(new Error(`API Error [${res.statusCode}]: ${errorMsg}`));
     }
    } catch (e) {
     reject(new Error(`Failed to parse JSON response. Status: ${res.statusCode}, Body: ${body.substring(0, 200)}...`));
    }
   });
  });
  req.on('error', reject);
  req.on('timeout', () => {
   req.destroy();
   reject(new Error(`Request timeout after ${timeout}ms`));
  });
  req.write(JSON.stringify(data));
  req.end();
 });
}

export async function callAI(...args) {
 let provider, model, messages, options = {};
 if (args.length === 4) [provider, model, messages, options = {}] = args;
 else if (args.length === 3) {
  if (typeof args[0] === 'string' && Array.isArray(args[1])) {
   model = args[0] || _DEFAULT.model;
   messages = args[1];
   options = args[2] || {};
   provider = findProviderForModel(model);
   if (!provider) throw new Error(`Unknown model: ${model}. Available: ${Object.entries(AI_PROVIDERS).flatMap(([p, c]) => Object.keys(c.models)).join(', ')}`);
  } else [provider, model, messages] = args;
 } else if (args.length === 2) {
  model = args[0];
  messages = args[1];
  provider = findProviderForModel(model);
  if (!provider) throw new Error(`Unknown model: ${model}. Available: ${Object.entries(AI_PROVIDERS).flatMap(([p, c]) => Object.keys(c.models)).join(', ')}`);
 } else throw new Error('Invalid arguments. Use: callAI(model, messages, options?) or callAI(provider, model, messages, options?)');

 if (!customModelsLoaded) await loadCustomModels();

 messages = messages.map(msg => ({ ...msg, content: Array.isArray(msg.content) ? normalizeContent(msg.content) : msg.content }));

 if (isVisionRequest(messages) && !supportsVision(provider, model)) {
  const visionModels = [];
  for (const [p, models] of Object.entries(VISION_MODELS)) {
   if (models === 'all') visionModels.push(`all ${p} models`);
   else if (Array.isArray(models) && models.length > 0) visionModels.push(...models);
  }
  throw new Error(`Model ${model} doesn't support images. Use one of: ${visionModels.join(', ')}`);
 }

 try {
  const config = AI_PROVIDERS[provider];
  if (!config) throw new Error(`Unknown provider: ${provider}`);
  if (!config.apiKey) {
   throw new Error(`Missing API key for ${provider}. Set ${provider === 'openai' ? 'OPENAI_API_KEY' : provider === 'mistral' ? 'MISTRAL_API_KEY' : 'TOGETHER_API_KEY'} in .env`);
  }
  const modelConfig = config.models[model];
  if (!modelConfig) throw new Error(`Unknown model: ${model} for provider: ${provider}`);
  const payload = config.formatPayload(messages, modelConfig.name, options.maxTokens, options);
  let apiUrl = config.baseUrl;
  const headers = {};
  if (provider === 'together') {
   headers['Authorization'] = `Bearer ${config.apiKey}`;
   headers['Content-Type'] = 'application/json';
  } else {
   headers['Authorization'] = `Bearer ${config.apiKey}`;
  }
  const response = await makeRequest(apiUrl, payload, headers, options.timeout || 480000);
  const text = config.extractResponse(response);
  const rawUsage = response.usage || response.usageMetadata || null;
  const normalizedUsage = normalizeUsage(provider, rawUsage, messages, text);
  const cost = {
   in: parseFloat(((normalizedUsage.prompt_tokens / 1_000_000) * modelConfig.cost.in).toFixed(6)),
   out: parseFloat(((normalizedUsage.completion_tokens / 1_000_000) * modelConfig.cost.out).toFixed(6)),
   total: 0
  };
  cost.total = parseFloat((cost.in + cost.out).toFixed(6));
  return { text, usage: normalizedUsage, model, cost };
 } catch (error) {
  if (error.message.includes('401')) throw new Error(`Authentication failed for ${provider}. Check your API key.`);
  if (error.message.includes('429')) throw new Error(`Rate limit exceeded for ${provider}. Try again later.`);
  if (error.message.includes('402')) throw new Error(`Payment required for ${provider}. Check account balance.`);
  throw new Error(`${provider} API call failed: ${error.message}`);
 }
}
