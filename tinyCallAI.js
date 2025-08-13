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
     if (AI_PROVIDERS[provider]) {
      Object.assign(AI_PROVIDERS[provider].models, models);
     }
    }
   }
  }
 } catch (error) {
  console.warn('Warning: Failed to load _models.js:', error.message);
 }
 
 customModelsLoaded = true;
}

const VISION_MODELS = {
  openai: ['gpt-4o','gpt-4om', 'gpt-4.1', 'gpt-4.1m', 'gpt-4.1n', 'gpt-o4m', 'gpt-5', 'gpt-5m', 'gpt-5n'],
  anthropic: 'all',
  gemini: 'all',
  mistral: ['mistral-small','mistral-medium', 'mistral-large', 'pixtral-large', 'pixtral-12b'],
  grok: []
};

const THINKING_MODELS = {
  openai: ['gpt-o3m', 'gpt-o4m', 'gpt-5', 'gpt-5m', 'gpt-5n'],
  anthropic: ['claude-3.7s', 'claude-4s', 'claude-4o', 'claude-4.1o'], 
  gemini: ['gemini-2.5p', 'gemini-2.5f', 'gemini-2.5fl'], 
  grok: ['grok-3m','grok-4']
};


function detectImageFormat(buffer) {
 if (!Buffer.isBuffer(buffer) || buffer.length < 4) return 'image/jpeg';
 if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
 if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'image/png';
 if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
  if (buffer.length > 12 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
   return 'image/webp';
  }
 }
 if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif';
 return 'image/jpeg';
}

function isVisionRequest(messages) {
 return messages.some(msg => 
  Array.isArray(msg.content) && 
  msg.content.some(item => item.type === 'image')
 );
}

function processImageContent(content) {
 if (Buffer.isBuffer(content)) {
  const base64 = content.toString('base64');
  const mimeType = detectImageFormat(content);
  return `data:${mimeType};base64,${base64}`;
 }
 if (typeof content === 'string' && !content.startsWith('data:')) {
  return `data:image/jpeg;base64,${content}`;
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
   return { thinkingBudget: budget };
  }
  if (provider === 'anthropic') {
   return { type: 'enabled', budget_tokens: budget };
  }
 }
 
 return null;
}

function normalizeContent(content) {
 if (typeof content === 'string') {
  return [{ type: 'text', text: content }];
 }
 if (Array.isArray(content)) {
  return content.map(item => {
   if (typeof item === 'string') return { type: 'text', text: item };
   if (item.type === 'image' && item.url !== undefined) {
    return { type: 'image', url: processImageContent(item.url) };
   }
   return item;
  });
 }
 return [{ type: 'text', text: String(content || '') }];
}

const AI_PROVIDERS = {
 openai: {
  apiKey: process.env.OPENAI_API_KEY || "",
  baseUrl: 'https://api.openai.com/v1/chat/completions',
  models: {
   'gpt-4o': { name: 'gpt-4o', cost: { in: 2.5, out: 10 } },
   'gpt-4om': { name: 'gpt-4o-mini', cost: { in: 0.15, out: 0.6 } },
   'gpt-4.1': { name: 'gpt-4.1', cost: { in: 2, out: 8 } },
   'gpt-4.1m': { name: 'gpt-4.1-mini', cost: { in: 0.4, out: 1.6 } },
   'gpt-4.1n': { name: 'gpt-4.1-nano', cost: { in: 0.1, out: 0.4 } },
   'gpt-5': { name: 'gpt-5', cost: { in: 1.25, out: 10 } },
   'gpt-5n': { name: 'gpt-5-mini', cost: { in: 0.25, out: 2 } },
   'gpt-5n': { name: 'gpt-5-nano', cost: { in: 0.05, out: 0.4 } },
   'gpt-o3m': { name: 'o3-mini', cost: { in: 1.1, out: 4.4 } },
   'gpt-o4m': { name: 'o4-mini', cost: { in: 1.1, out: 4.4 } }
  },
  formatPayload: (messages, model, maxTokens, options = {}) => {
   const isVision = isVisionRequest(messages);
   
   let processedMessages = messages;
   if (isVision) {
    processedMessages = messages.map(msg => {
     if (Array.isArray(msg.content)) {
      return {
       ...msg,
       content: msg.content.map(item => {
        if (item.type === 'image') {
         return {
          type: 'image_url',
          image_url: { url: processImageContent(item.url) }
         };
        }
        return item;
       })
      };
     } else if (typeof msg.content === 'string') {
      return msg;
     }
     return msg;
    });
   }
   
   const payload = { model, messages: processedMessages, temperature: options.temperature || 0.7 };
   
   if (/^(o[3-4](-mini)?|gpt-5(-mini|-nano)?)$/.test(model)) {
    payload.max_completion_tokens = maxTokens || 4096;
    payload.temperature = 1;
    
    const thinking = getThinkingConfig('openai', model, options.think);
    if (thinking) {
     payload.reasoning_effort = thinking.reasoning_effort;
    }
   } else {
    payload.max_tokens = maxTokens || 4096;
   }
   
   return payload;
  },
  extractResponse: (data) => data.choices[0].message.content
 },

 anthropic: {
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  baseUrl: 'https://api.anthropic.com/v1/messages',
  models: {
   'claude-4.1o': { name: 'claude-opus-4-1-20250805', cost: { in: 3.0, out: 15.0 } },
   'claude-4o': { name: 'claude-opus-4-20250514', cost: { in: 3.0, out: 15.0 } },
   'claude-4s': { name: 'claude-sonnet-4-20250514', cost: { in: 3.0, out: 15.0 } },
   'claude-3.7s': { name: 'claude-3-7-sonnet-20250219', cost: { in: 3.0, out: 15.0 } },
   'claude-3.5s': { name: 'claude-3-5-sonnet-20241022', cost: { in: 3.0, out: 15.0 } },
   'claude-3.5h': { name: 'claude-3-5-haiku-20241022', cost: { in: 0.8, out: 4.0 } },
   'claude-3-h': { name: 'claude-3-haiku-20240307', cost: { in: 0.4, out: 1.6 } }
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

   const payload = { model, messages: convertedMessages, max_tokens: maxTokens || 4096 };

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
   'mistral-large': { name: 'mistral-large-latest', cost: { in: 2, out: 6 } },
   'mistral-medium': { name: 'mistral-medium-latest', cost: { in: 0.4, out: 2 } },
   'mistral-small': { name: 'mistral-small-2506', cost: { in: 0.1, out: 0.3 } },
   'mistral-8b': { name: 'ministral-8b-latest', cost: { in: 0.09, out: 0.09 } },
   'mistral-3b': { name: 'ministral-3b-latest', cost: { in: 0.04, out: 0.04 } },
   'mistral-tiny': { name: 'mistral-tiny-latest', cost: { in: 0.14, out: 0.14 } },
   'magistral-medium': { name: 'magistral-medium-latest', cost: { in: 2, out: 5 } }, 
   'magistral-small': { name: 'magistral-small-latest', cost: { in: 0.5, out: 1.5 } }, 
   'pixtral-large': { name: 'pixtral-large-latest', cost: { in: 2.0, out: 6.0 } },
   'pixtral-12b': { name: 'pixtral-12b', cost: { in: 0.15, out: 0.15 } },

  },
  formatPayload: (messages, model, maxTokens, options = {}) => {
   const isVision = isVisionRequest(messages);
   
   let processedMessages = messages;
   if (isVision) {
    processedMessages = messages.map(msg => {
     if (Array.isArray(msg.content)) {
      return {
       ...msg,
       content: msg.content.map(item => {
        if (item.type === 'image') {
         const dataUrl = processImageContent(item.url);
         return {
          type: 'image_url',
          image_url: { url: dataUrl }
         };
        }
        return item;
       })
      };
     }
     return msg;
    });
   }
   
   return {
    model,
    messages: processedMessages,
    max_tokens: maxTokens || 4096,
    temperature: options.temperature || 0.7
   };
  },
  extractResponse: (data) => data.choices[0].message.content
 },

 grok: {
  apiKey: process.env.XAI_API_KEY || '',
  baseUrl: 'https://api.x.ai/v1/chat/completions',
  models: {
'grok-4': { name: 'grok-4-latest', cost: { in: 3, out: 15 } },
'grok-3': { name: 'grok-3-latest', cost: { in: 3, out: 15 } },
'grok-3m': { name: 'grok-3-mini-latest', cost: { in: 0.3, out: 0.5 } }
   
  },
  formatPayload: (messages, model, maxTokens, options = {}) => {
   const payload = { model, messages, max_tokens: maxTokens || 4096, temperature: options.temperature || 0.7 };

   const thinking = getThinkingConfig('grok', model, options.think);
   if (thinking) {
    payload.reasoning_effort = thinking.reasoning_effort;
   }

   return payload;
  },
  extractResponse: (data) => data.choices[0].message.content
 },

 gemini: {
  apiKey: process.env.GEMINI_API_KEY || '',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
  models: {
   'gemini-2.5p': { name: 'gemini-2.5-pro', cost: { in: 1.25, out: 10 } },
   'gemini-2.5f': { name: 'gemini-2.5-flash', cost: { in: 0.3, out: 2.50 } },
   'gemini-2.5fl': { name: 'gemini-2.5-flash-lite', cost: { in: 0.1, out: 0.40 } },
   'gemini-2f': { name: 'gemini-2.0-flash', cost: { in: 0.1, out: 0.40 } },
   'gemini-2fl': { name: 'gemini-2.0-flash-lite', cost: { in: 0.075, out: 0.30 } }
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
    generationConfig: { maxOutputTokens: maxTokens || 4096, temperature: options.temperature || 0.7 }
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
   if (typeof msg.content === 'string') {
    return sum + msg.content.length;
   } else if (Array.isArray(msg.content)) {
    return sum + msg.content.reduce((s, item) => {
     if (item.type === 'text') return s + (item.text?.length || 0);
     if (item.type === 'image') return s + 1000;
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
  prompt_tokens: usage.prompt_tokens || 0,
  completion_tokens: usage.completion_tokens || 0,
  total_tokens: usage.total_tokens || ((usage.prompt_tokens || 0) + (usage.completion_tokens || 0))
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
     if (res.statusCode >= 200 && res.statusCode < 300) {
      resolve(parsed);
     } else {
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

 if (args.length === 4) {
  [provider, model, messages, options = {}] = args;
 } else if (args.length === 3) {
  if (typeof args[0] === 'string' && Array.isArray(args[1])) {
   model = args[0] || '2.0-flash';
   messages = args[1];
   options = args[2] || {};
   provider = findProviderForModel(model);
   if (!provider) {
    throw new Error(`Unknown model: ${model}. Available models: ${Object.entries(AI_PROVIDERS).flatMap(([p, c]) => Object.keys(c.models)).join(', ')}`);
   }
  } else {
   [provider, model, messages] = args;
  }
 } else if (args.length === 2) {
  model = args[0];
  messages = args[1];
  provider = findProviderForModel(model);
  if (!provider) {
   throw new Error(`Unknown model: ${model}. Available models: ${Object.entries(AI_PROVIDERS).flatMap(([p, c]) => Object.keys(c.models)).join(', ')}`);
  }
 } else {
  throw new Error('Invalid arguments. Use: callAI(model, messages, options?) or callAI(provider, model, messages, options?)');
 }

 if (!customModelsLoaded) {
  await loadCustomModels();
 }

 messages = messages.map(msg => ({
  ...msg,
  content: Array.isArray(msg.content) ? normalizeContent(msg.content) : msg.content
 }));

 if (isVisionRequest(messages) && !supportsVision(provider, model)) {
  const visionModels = [];
  for (const [p, models] of Object.entries(VISION_MODELS)) {
   if (models === 'all') {
    visionModels.push(`all ${p} models`);
   } else if (Array.isArray(models) && models.length > 0) {
    visionModels.push(...models);
   }
  }
  throw new Error(`Model ${model} doesn't support images. Use one of: ${visionModels.join(', ')}`);
 }

 try {
  const config = AI_PROVIDERS[provider];
  if (!config) throw new Error(`Unknown provider: ${provider}`);

  if (!config.apiKey) {
   throw new Error(`Missing API key for ${provider}. Please set ${provider === 'openai' ? 'OPENAI_API_KEY' : provider === 'mistral' ? 'MISTRAL_API_KEY' : provider === 'gemini' ? 'GEMINI_API_KEY' : provider === 'grok' ? 'XAI_API_KEY' : 'API_KEY'} environment variable`);
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
   in: parseFloat(((normalizedUsage.prompt_tokens / 1_000_000) * modelConfig.cost.in).toFixed(8)),
   out: parseFloat(((normalizedUsage.completion_tokens / 1_000_000) * modelConfig.cost.out).toFixed(8)),
   total: 0
  };
  cost.total = parseFloat((cost.in + cost.out));

  return { text, usage: normalizedUsage, model, cost };

 } catch (error) {
  if (error.message.includes('401')) {
   throw new Error(`Authentication failed for ${provider}. Check if your API key is valid.`);
  }
  if (error.message.includes('429')) {
   throw new Error(`Rate limit exceeded for ${provider}. Please wait and try again.`);
  }
  if (error.message.includes('402')) {
   throw new Error(`Payment required for ${provider}. Check your account balance.`);
  }
  if (provider === 'anthropic' && error.message.includes('invalid_api_key')) {
   throw new Error('Invalid Anthropic API key. Check if it starts with sk-ant-api03-');
  }
  throw new Error(`${provider} API call failed: ${error.message}`);
 }
}
