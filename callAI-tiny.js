/* tinyCallAI library
 * License: MIT
 * ------------------------------------------------------------------------------
 * Copyright (c) 2025 Jakub Śledzikowski <jakub@jsle.eu>
 *
 */




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
 openai: ['gpt-4om', 'gpt-4.1', 'gpt-4.1m', 'gpt-4.1n', 'gpt-5', 'gpt-5m', 'gpt-5n', 'gpt-o3m', 'gpt-o4m'],
 anthropic: 'all',
 gemini: 'all',
 mistral: ['mistral-small','mistral-medium', 'mistral-large', 'pixtral-large', 'pixtral-12b'],
 grok: ['grok-4'],
 together: ['qw2.5-vl-72b', 'llam4-mav', 'llam4-sc', 'gemma-3n-4b', 'qw2-vl-72b']
};

const THINKING_MODELS = {
 openai: ['gpt-o3m', 'gpt-5', 'gpt-5m', 'gpt-5n'],
 anthropic: ['claude-3.7s', 'claude-4s', 'claude-4o', 'claude-4.1o'], 
 gemini: ['gemini-2.5p', 'gemini-2.5f', 'gemini-2.5fl'], 
 grok: ['grok-3m','grok-4']
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
 if (typeof content === 'string' && !content.startsWith('data:') && !/^https?:\/\//i.test(content)) {
  // Base64 string without data URL prefix
  const mimeType = detectImageFormat(Buffer.from(content, 'base64'));
  return `data:${mimeType};base64,${content}`;
 }
 return content;
}

function supportsVision(provider, model) {
 const models = VISION_MODELS[provider];
 if (!models) return false;
 return models === 'all' || (Array.isArray(models) && models.includes(model));
}

function supportsThinking(provider, model) {
 const models = THINKING_MODELS[provider];
 return models && models.includes(model);
}

function getThinkingConfig(provider, model, thinkValue) {
 if (thinkValue === undefined || thinkValue === false || thinkValue === 0) {
  return null;
 }
 
 if (!supportsThinking(provider, model)) {
  return null;
 }
 
 if (provider === 'grok') {
  if (thinkValue === 'low' || thinkValue === 'high') {
   return { reasoning_effort: thinkValue };
  }
  if (thinkValue === true || thinkValue === 'medium') {
   return { reasoning_effort: 'low' };
  }
  throw new Error(`Grok models only support think: 'low' or 'high', not '${thinkValue}'`);
 }
 
 if (provider === 'openai' && /^(o[3-4](-mini)?|gpt-5(-mini|-nano)?)$/.test(model)) {
  if (['low', 'medium', 'high'].includes(thinkValue)) {
   return { reasoning_effort: thinkValue };
  }
  if (thinkValue === true) {
   return { reasoning_effort: 'medium' };
  }
  throw new Error(`OpenAI ${model} only supports think: 'low', 'medium', or 'high', not '${thinkValue}'`);
 }
 
 let budget = 0;
 if (typeof thinkValue === 'number') {
  budget = thinkValue;
 } else if (thinkValue === true || thinkValue === 'medium') {
  budget = 2048;
 } else if (thinkValue === 'low') {
  budget = 1024;
 } else if (thinkValue === 'high') {
  budget = 4096;
 }
 
 if (budget > 0) {
  if (provider === 'gemini') {
   // Gemini: 512-24576 limit
   budget = Math.max(512, Math.min(24576, budget));
   return { thinkingBudget: budget };
  }
  if (provider === 'anthropic') {
   // Claude: 1024-8012 limit  
   budget = Math.max(1024, Math.min(8012, budget));
   return { type: 'enabled', budget_tokens: budget };
  }
 }
 
 return null;
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
   '4o-mini': { name: 'gpt-4o-mini', cost: { in: 0.15, out: 0.6 } },
   'gpt-4om': { name: 'gpt-4o-mini', cost: { in: 0.15, out: 0.6 } },
   '4.1': { name: 'gpt-4.1', cost: { in: 2, out: 8 } },
   'gpt-4.1': { name: 'gpt-4.1', cost: { in: 2, out: 8 } },
   '4.1-mini': { name: 'gpt-4.1-mini', cost: { in: 0.4, out: 1.6 } },
   'gpt-4.1m': { name: 'gpt-4.1-mini', cost: { in: 0.4, out: 1.6 } },
   '4.1-nano': { name: 'gpt-4.1-nano', cost: { in: 0.1, out: 0.4 } },
   'gpt-4.1n': { name: 'gpt-4.1-nano', cost: { in: 0.1, out: 0.4 } },
   '5.0': { name: 'gpt-5', cost: { in: 1.25, out: 10 } },
   'gpt-5': { name: 'gpt-5', cost: { in: 1.25, out: 10 } },
   '5.0-mini': { name: 'gpt-5-mini', cost: { in: 0.25, out: 2 } },
   'gpt-5m': { name: 'gpt-5-mini', cost: { in: 0.25, out: 2 } },
   '5.0-nano': { name: 'gpt-5-nano', cost: { in: 0.05, out: 0.4 } },
   'gpt-5n': { name: 'gpt-5-nano', cost: { in: 0.05, out: 0.4 } },
   'o3-mini': { name: 'o3-mini', cost: { in: 1.1, out: 4.4 } },
   'gpt-o3m': { name: 'o3-mini', cost: { in: 1.1, out: 4.4 } },
   'o4-mini': { name: 'o4-mini', cost: { in: 1.1, out: 4.4 } },
   'gpt-o4m': { name: 'o4-mini', cost: { in: 1.1, out: 4.4 } }
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
   
   if (/^(o[3-4](-mini)?|gpt-5(-mini|-nano)?)$/.test(model)) {
    payload.max_completion_tokens = maxTokens || _DEFAULT.maxTokens;
    payload.temperature = 1;
    
    const thinking = getThinkingConfig('openai', model, options.think);
    if (thinking) {
     payload.reasoning_effort = thinking.reasoning_effort;
    }
   } else {
    payload.max_tokens = maxTokens || _DEFAULT.maxTokens;
   }
   
   return payload;
  },
  extractResponse: (data) => data.choices?.[0]?.message?.content ?? ''
 },

 anthropic: {
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  baseUrl: 'https://api.anthropic.com/v1/messages',
  models: {
   '4.1-opus': { name: 'claude-opus-4-1-20250805', cost: { in: 15, out: 75 } },
   'claude-4.1o': { name: 'claude-opus-4-1-20250805', cost: { in: 15, out: 75 } },
   '4-opus': { name: 'claude-opus-4-20250514', cost: { in: 15, out: 75 } },
   'claude-4o': { name: 'claude-opus-4-20250514', cost: { in: 15, out: 75 } },
   '4-sonnet': { name: 'claude-sonnet-4-20250514', cost: { in: 3, out: 15 } },
   'claude-4s': { name: 'claude-sonnet-4-20250514', cost: { in: 3, out: 15 } },
   '3.7-sonnet': { name: 'claude-3-7-sonnet-20250219', cost: { in: 3, out: 15 } },
   'claude-3.7s': { name: 'claude-3-7-sonnet-20250219', cost: { in: 3, out: 15 } },
   '3.5-sonnet': { name: 'claude-3-5-sonnet-20241022', cost: { in: 3, out: 15 } },
   'claude-3.5s': { name: 'claude-3-5-sonnet-20241022', cost: { in: 3, out: 15 } },
   '3.5-haiku': { name: 'claude-3-5-haiku-20241022', cost: { in: 0.8, out: 4 } },
   'claude-3.5h': { name: 'claude-3-5-haiku-20241022', cost: { in: 0.8, out: 4 } },
   '3-haiku': { name: 'claude-3-haiku-20240307', cost: { in: 0.4, out: 1.6 } },
   'claude-3h': { name: 'claude-3-haiku-20240307', cost: { in: 0.4, out: 1.6 } }
  },
  formatPayload: (messages, model, maxTokens, options = {}) => {
   let systemMessage = '';
   const convertedMessages = [];
   const isVision = isVisionRequest(messages);

   for (const msg of messages) {
    if (msg.role === 'system') {
     systemMessage = msg.content;
     continue;
    }
    
    if (msg.role === 'user' || msg.role === 'assistant') {
     if (isVision && Array.isArray(msg.content)) {
      const processedContent = msg.content.map(item => {
       if (item.type === 'image') {
        const dataUrl = processImageContent(item.url);
        const base64 = dataUrl.split(',')[1];
        const mimeMatch = dataUrl.match(/data:([^;]+)/);
        const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
        return {
         type: 'image',
         source: {
          type: 'base64',
          media_type: mimeType,
          data: base64
         }
        };
       }
       return item;
      });
      convertedMessages.push({ role: msg.role, content: processedContent });
     } else {
      convertedMessages.push({ role: msg.role, content: msg.content });
     }
    }
   }

   if (convertedMessages.length === 0 && systemMessage) {
    convertedMessages.push({ role: 'user', content: '[SYSTEM INSTRUCTIONS]'+systemMessage });
    systemMessage = '';
   }

   const payload = { model, messages: convertedMessages, max_tokens: maxTokens || _DEFAULT.maxTokens };

   const thinking = getThinkingConfig('anthropic', model, options.think);
   if (thinking) {
    payload.thinking = thinking;
   }

   if (systemMessage && systemMessage.trim() !== '') {
    payload.system = systemMessage;
   }

   return payload;
  },
  extractResponse: (data) => data.content[0].text
 },

 mistral: {
  apiKey: process.env.MISTRAL_API_KEY || '',
  baseUrl: 'https://api.mistral.ai/v1/chat/completions',
  models: {
   'mistral-small': { name: 'mistral-small-latest', cost: { in: 0.1, out: 0.3 } },
   'mistral-large': { name: 'mistral-large-latest', cost: { in: 2, out: 6 } },
   'mistral-medium': { name: 'mistral-medium-latest', cost: { in: 0.4, out: 2 } },
   'ministral-8b': { name: 'ministral-8b-latest', cost: { in: 0.1, out: 0.3 } },
   'ministral-3b': { name: 'ministral-3b-latest', cost: { in: 0.04, out: 0.04 } },
   'magistral-small': { name: 'magistral-small-latest', cost: { in: 0.5, out: 1.5 } },
   'magistral-medium': { name: 'magistral-medium-latest', cost: { in: 0.5, out: 1.5 } },
   'pixtral-large': { name: 'pixtral-large-latest', cost: { in: 2, out: 6 } },
   'pixtral-12b': { name: 'pixtral-12b', cost: { in: 0.15, out: 0.15 } }
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

 grok: {
  apiKey: process.env.XAI_API_KEY || '',
  baseUrl: 'https://api.x.ai/v1/chat/completions',
  models: {
   'grok-4': { name: 'grok-4-latest', cost: { in: 3, out: 15 } },
   'grok-3-mini': { name: 'grok-3-mini-latest', cost: { in: 0.1, out: 0.5 } },
   'grok-3m': { name: 'grok-3-mini-latest', cost: { in: 0.1, out: 0.5 } },
   'grok-code-fast': { name: 'grok-code-fast', cost: { in: 0.2, out: 1.5 } }
  },
  formatPayload: (messages, model, maxTokens, options = {}) => {
   const payload = { model, messages, max_tokens: maxTokens || _DEFAULT.maxTokens, temperature: options.temperature || _DEFAULT.temperature };

   const thinking = getThinkingConfig('grok', model, options.think);
   if (thinking) {
    payload.reasoning_effort = thinking.reasoning_effort;
   }

   return payload;
  },
  extractResponse: (data) => data.choices?.[0]?.message?.content ?? ''
 },

 gemini: {
  apiKey: process.env.GEMINI_API_KEY || '',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
  models: {
   '2.5-flash': { name: 'gemini-2.5-flash', cost: { in: 0.3, out: 2.5 } },
   'gemini-2.5f': { name: 'gemini-2.5-flash', cost: { in: 0.3, out: 2.5 } },
   '2.5-pro': { name: 'gemini-2.5-pro', cost: { in: 1.25, out: 10 } },
   'gemini-2.5p': { name: 'gemini-2.5-pro', cost: { in: 1.25, out: 10 } },
   '2.5-flash-lite': { name: 'gemini-2.5-flash-lite-preview-06-17', cost: { in: 0.1, out: 0.4 } },
   'gemini-2.5fl': { name: 'gemini-2.5-flash-lite-preview-06-17', cost: { in: 0.1, out: 0.4 } },
   '2.0-flash': { name: 'gemini-2.0-flash', cost: { in: 0.1, out: 0.4 } },
   'gemini-2f': { name: 'gemini-2.0-flash', cost: { in: 0.1, out: 0.4 } },
   '2.0-flash-lite': { name: 'gemini-2.0-flash-lite', cost: { in: 0.075, out: 0.3 } },
   'gemini-2fl': { name: 'gemini-2.0-flash-lite', cost: { in: 0.075, out: 0.3 } }
  },
  formatPayload: (messages, model, maxTokens, options = {}) => {
   let systemMessage = '';
   const convertedMessages = [];
   const isVision = isVisionRequest(messages);

   for (const msg of messages) {
    if (msg.role === 'system') {
     systemMessage = msg.content;
     continue;
    }

    if (msg.role !== 'user' && msg.role !== 'assistant') continue;

    const currentRole = msg.role === 'assistant' ? 'model' : 'user';
    let parts;

    if (isVision && Array.isArray(msg.content)) {
     parts = msg.content.map(item => {
      if (item.type === 'image') {
       const dataUrl = processImageContent(item.url);
       const base64 = dataUrl.split(',')[1];
       const mimeMatch = dataUrl.match(/data:([^;]+)/);
       const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
       return {
        inlineData: {
         mimeType: mimeType,
         data: base64
        }
       };
      }
      if (item.type === 'text') {
       return { text: item.text };
      }
      return { text: String(item) };
     });
    } else if (Array.isArray(msg.content)) {
     parts = msg.content;
    } else if (typeof msg.content === 'string') {
     parts = [{ text: msg.content }];
    } else {
     continue;
    }

    const lastMessage = convertedMessages[convertedMessages.length - 1];
    if (lastMessage && lastMessage.role === currentRole) {
     lastMessage.parts.push(...parts);
    } else {
     convertedMessages.push({ role: currentRole, parts: parts });
    }
   }

   if (convertedMessages.length === 0 && systemMessage) {
    convertedMessages.push({ role: 'user', parts: [{ text: systemMessage }] });
    systemMessage = '';
   }

   const payload = {
    contents: convertedMessages,
    generationConfig: { maxOutputTokens: maxTokens || _DEFAULT.maxTokens, temperature: options.temperature || _DEFAULT.temperature }
   };

   const thinking = getThinkingConfig('gemini', model, options.think);
   if (thinking) {
    payload.generationConfig.thinkingConfig = thinking;
   }

   if (systemMessage && systemMessage.trim() !== '') {
    payload.system_instruction = { parts: [{ text: systemMessage }] };
   }

   return payload;
  },
  extractResponse: (data) => {
   if (!data.candidates?.length || !data.candidates[0].content?.parts?.length) {
    throw new Error('Invalid Gemini response structure');
   }
   return data.candidates[0].content.parts.filter(p => p.text).map(p => p.text).join('');
  }
 },

 together: {
  apiKey: process.env.TOGETHER_API_KEY || '',
  baseUrl: 'https://api.together.xyz/v1/chat/completions',
  models: {
   'qw3-235b-think': { name: 'Qwen/Qwen3-235B-A22B-Thinking-2507', cost: { in: 0.65, out: 3 } },
   'qw3-480b': { name: 'Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8', cost: { in: 2, out: 2 } },
   'qw3-235b-tput': { name: 'Qwen/Qwen3-235B-A22B-Instruct-2507-tput', cost: { in: 0.2, out: 0.6 } },
   'qw2.5-vl-72b': { name: 'Qwen/Qwen2.5-VL-72B-Instruct', cost: { in: 1.95, out: 8 } },
   'qwq-32b': { name: 'Qwen/QwQ-32B', cost: { in: 1.2, out: 1.2 } },
   'llam4-mav': { name: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8', cost: { in: 0.27, out: 0.85 } },
   'llam4-sc': { name: 'meta-llama/Llama-4-Scout-17B-16E-Instruct', cost: { in: 0.18, out: 0.59 } },
   'llam3.3-70b-t': { name: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', cost: { in: 0.88, out: 0.88 } },
   'mx-8x7b': { name: 'mistralai/Mixtral-8x7B-Instruct-v0.1', cost: { in: 0.6, out: 0.6 } },
   'ms-7b': { name: 'mistralai/Mistral-7B-Instruct-v0.1', cost: { in: 0.2, out: 0.2 } },
   'ms-24b': { name: 'mistralai/Mistral-Small-24B-Instruct-2501', cost: { in: 0.8, out: 0.8 } },
   'ds-r1': { name: 'deepseek-ai/DeepSeek-R1', cost: { in: 3, out: 7 } },
   'ds-v3': { name: 'deepseek-ai/DeepSeek-V3', cost: { in: 1.25, out: 1.25 } },
   'ds-r1-tput': { name: 'deepseek-ai/DeepSeek-R1-0528-tput', cost: { in: 0.55, out: 2.19 } },
   'ds-r1-dis-llam': { name: 'deepseek-ai/DeepSeek-R1-Distill-Llama-70B', cost: { in: 2, out: 2 } },
   'ds-r1-dis-qw': { name: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-14B', cost: { in: 1.6, out: 1.6 } },
   'gemma-3n-4b': { name: 'google/gemma-3n-E4B-it', cost: { in: 0.02, out: 0.04 } },
   'oai-gpt-20b': { name: 'openai/gpt-oss-20b', cost: { in: 0.05, out: 0.2 } },
   'oai-gpt-120b': { name: 'openai/gpt-oss-120b', cost: { in: 0.15, out: 0.6 } },
   'kimi-k2': { name: 'moonshotai/Kimi-K2-Instruct', cost: { in: 1, out: 3 } },
   'glm-4.5-air': { name: 'zai-org/GLM-4.5-Air-FP8', cost: { in: 0.2, out: 1.1 } },
   'exa-3.5-32b': { name: 'lgai/exaone-3-5-32b-instruct', cost: { in: 0, out: 0 } },
   'exa-deep-32b': { name: 'lgai/exaone-deep-32b', cost: { in: 0, out: 0 } },
   'rf-small': { name: 'togethercomputer/Refuel-Llm-V2-Small', cost: { in: 0.2, out: 0.2 } },
   'cog-v2-70b': { name: 'deepcogito/cogito-v2-preview-llama-70B', cost: { in: 0.88, out: 0.88 } },
   'llam3.1-8b-t': { name: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', cost: { in: 0.18, out: 0.18 } },
   'qw2.5-7b-t': { name: 'Qwen/Qwen2.5-7B-Instruct-Turbo', cost: { in: 0.3, out: 0.3 } },
   'qw2.5-72b-t': { name: 'Qwen/Qwen2.5-72B-Instruct-Turbo', cost: { in: 1.2, out: 1.2 } },
   'qw2.5-coder-32b': { name: 'Qwen/Qwen2.5-Coder-32B-Instruct', cost: { in: 1.2, out: 1.2 } },
   'qw3-235b-tput-fp8': { name: 'Qwen/Qwen3-235B-A22B-fp8-tput', cost: { in: 0.2, out: 0.6 } },
   'arcee-coder-l': { name: 'arcee-ai/coder-large', cost: { in: 0.5, out: 0.8 } },
   'arcee-maestro': { name: 'arcee-ai/maestro-reasoning', cost: { in: 0.9, out: 3.3 } },
   'llam3.1-405b-t': { name: 'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo', cost: { in: 3.5, out: 3.5 } },
   'llam3.2-3b-t': { name: 'meta-llama/Llama-3.2-3B-Instruct-Turbo', cost: { in: 0.06, out: 0.06 } }
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

 if (provider === 'gemini' && usage.promptTokenCount !== undefined) {
  return {
   prompt_tokens: usage.promptTokenCount || 0,
   completion_tokens: usage.candidatesTokenCount || 0,
   total_tokens: (usage.promptTokenCount || 0) + (usage.candidatesTokenCount || 0)
  };
 }

 if (provider === 'anthropic' && (usage.input_tokens !== undefined || usage.output_tokens !== undefined)) {
  return {
   prompt_tokens: usage.input_tokens || 0,
   completion_tokens: usage.output_tokens || 0,
   total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0)
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
   throw new Error(`Missing API key for ${provider}. Set ${provider === 'openai' ? 'OPENAI_API_KEY' : provider === 'mistral' ? 'MISTRAL_API_KEY' : provider === 'gemini' ? 'GEMINI_API_KEY' : provider === 'grok' ? 'XAI_API_KEY' : provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'TOGETHER_API_KEY'} in .env`);
  }
  
  const modelConfig = config.models[model];
  if (!modelConfig) throw new Error(`Unknown model: ${model} for provider: ${provider}`);
  
  const payload = config.formatPayload(messages, modelConfig.name, options.maxTokens, options);
  let apiUrl = config.baseUrl;
  const headers = {};
  
  if (provider === 'anthropic') {
   headers['x-api-key'] = config.apiKey;
   headers['anthropic-version'] = '2023-06-01';
  } else if (provider === 'gemini') {
   apiUrl = `${config.baseUrl}/${modelConfig.name}:generateContent?key=${config.apiKey}`;
  } else {
   headers['Authorization'] = `Bearer ${config.apiKey}`;
  }
  
  const response = await makeRequest(apiUrl, payload, headers, options.timeout || 480000);
  const text = config.extractResponse(response);
  const rawUsage = provider === 'gemini' ? response.usageMetadata : response.usage;
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
  if (provider === 'anthropic' && error.message.includes('invalid_api_key')) {
   throw new Error('Invalid Anthropic API key. Check if it starts with sk-ant-api03-');
  }
  throw new Error(`${provider} API call failed: ${error.message}`);
 }
}

// Helpery do generowania testowych list modeli (po jednym aliasie na unikalny model)
function getUniqueModels() {
  const seen = new Set();
  const result = [];
  for (const [, cfg] of Object.entries(AI_PROVIDERS)) {
    for (const [alias, mcfg] of Object.entries(cfg.models)) {
      const canonical = mcfg.name || alias;
      if (!seen.has(canonical)) {
        seen.add(canonical);
        result.push(alias);
      }
    }
  }
  return result;
}

function getVisionTestModels() {
  const seen = new Set();
  const result = [];

  for (const [provider, vmodels] of Object.entries(VISION_MODELS)) {
    const cfg = AI_PROVIDERS[provider];
    if (!cfg) continue;

    if (vmodels === 'all') {
      for (const [alias, mcfg] of Object.entries(cfg.models)) {
        const canonical = mcfg.name || alias;
        if (!seen.has(canonical)) {
          seen.add(canonical);
          result.push(alias);
        }
      }
    } else if (Array.isArray(vmodels)) {
      for (const aliasOrName of vmodels) {
        if (cfg.models[aliasOrName]) {
          const mcfg = cfg.models[aliasOrName];
          const canonical = mcfg.name || aliasOrName;
          if (!seen.has(canonical)) {
            seen.add(canonical);
            result.push(aliasOrName);
          }
        } else {
          // spróbuj znaleźć alias po wartości name
          const found = Object.entries(cfg.models).find(([,m]) => m.name === aliasOrName || m.name === (aliasOrName));
          if (found) {
            const alias = found[0];
            const canonical = found[1].name;
            if (!seen.has(canonical)) {
              seen.add(canonical);
              result.push(alias);
            }
          }
        }
      }
    }
  }

  return result;
}

function getThinkingTestModels() {
  const seen = new Set();
  const result = [];

  for (const [provider, tmodels] of Object.entries(THINKING_MODELS)) {
    const cfg = AI_PROVIDERS[provider];
    if (!cfg) continue;

    if (Array.isArray(tmodels)) {
      for (const aliasOrName of tmodels) {
        if (cfg.models[aliasOrName]) {
          const mcfg = cfg.models[aliasOrName];
          const canonical = mcfg.name || aliasOrName;
          if (!seen.has(canonical)) {
            seen.add(canonical);
            result.push(aliasOrName);
          }
        } else {
          const found = Object.entries(cfg.models).find(([,m]) => m.name === aliasOrName);
          if (found) {
            const alias = found[0];
            const canonical = found[1].name;
            if (!seen.has(canonical)) {
              seen.add(canonical);
              result.push(alias);
            }
          }
        }
      }
    }
  }

  return result;
}

// Helpers: dostępne modele (z ustawionymi kluczami API)
function getAvailableModels() {
  return getUniqueModels().filter(alias => {
    const p = findProviderForModel(alias);
    return p && AI_PROVIDERS[p]?.apiKey;
  });
}

function getAvailableVisionModels() {
  return getVisionTestModels().filter(alias => {
    const p = findProviderForModel(alias);
    return p && AI_PROVIDERS[p]?.apiKey && supportsVision(p, alias);
  });
}

function getAvailableThinkingModels() {
  return getThinkingTestModels().filter(alias => {
    const p = findProviderForModel(alias);
    return p && AI_PROVIDERS[p]?.apiKey && supportsThinking(p, alias);
  });
}

export { getUniqueModels, getVisionTestModels, getThinkingTestModels, getAvailableModels, getAvailableVisionModels, getAvailableThinkingModels };
export default callAI;
