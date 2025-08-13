# tinyCall.js 🤖

Hey there! Welcome to tinyCall - your friendly neighborhood AI provider wrapper that makes talking to LLMs as easy as making a phone call. No more juggling five different SDKs or remembering which provider uses what format. Just pure, simple AI conversations.

## Why tinyCall?

Look, we've all been there. You start a project with OpenAI, then you want to try Claude, maybe experiment with Gemini... and suddenly you're drowning in different SDKs, each with their own quirks. That's where tinyCall comes in - one function to rule them all.

```javascript
// This is all you need. Seriously.
const response = await callAI('claude-4s', messages);
```

## What's in the Box?

- **5 Major AI Providers**: OpenAI, Anthropic, Google Gemini, Mistral, and xAI (Grok)
- **Latest Models**: Including GPT-5, Claude 4.1 Opus, Gemini 2.5 Pro, and Grok 4
- **Vision Support**: Send images to models that can see
- **Thinking/Reasoning Mode**: For those deep thoughts with o3-mini, Claude, and Gemini
- **Zero Dependencies**: Just good ol' Node.js - no bloat, no fuss
- **Cost Tracking**: Know exactly how much each call costs you
- **Custom Models**: Bring your own models via `_models.js`

## Quick Start

### Installation

Just drop `tinyCall.js` into your project:

```bash
# Clone it, download it, copy-paste it - dealer's choice
cp tinyCall.js your-project/
```

### Set Up Your Keys

Create a `.env` file (we'll keep your secrets safe):

```env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-api03-...
GEMINI_API_KEY=...
MISTRAL_API_KEY=...
XAI_API_KEY=...
```

Pro tip: You only need keys for the providers you're actually using. Not planning to chat with Grok? Skip the XAI key.

### Your First Call

```javascript
import { callAI } from './tinyCall.js';

// The simplest thing that could possibly work
const response = await callAI('claude-3.5s', [
  { role: 'user', content: 'Tell me a joke about APIs' }
]);

console.log(response.text);
// "Why did the API go to therapy? It had too many issues with commitment... kept breaking promises!"

// Want to know the damage?
console.log(`Cost: $${response.cost.total.toFixed(6)}`);
```

## The Cool Stuff

### Mix and Match Models

Can't decide between providers? Why choose! Jump between them like a digital nomad:

```javascript
// Start with Claude for creative writing
const story = await callAI('claude-3.5s', [
  { role: 'user', content: 'Start a mystery story' }
]);

// Get Gemini to continue it
const continuation = await callAI('gemini-2.5f', [
  { role: 'user', content: `Continue this story: ${story.text}` }
]);

// Have GPT-5 wrap it up
const ending = await callAI('gpt-5', [
  { role: 'user', content: `Write an ending: ${continuation.text}` }
]);
```

### Vision Mode 👁️

Got images? We got you covered:

```javascript
import fs from 'fs';

const imageBuffer = fs.readFileSync('cat.jpg');

const response = await callAI('gpt-4o', [
  {
    role: 'user',
    content: [
      { type: 'text', text: 'What do you see?' },
      { type: 'image', url: imageBuffer }  // Works with Buffer, base64, or data URLs
    ]
  }
]);
```

The library automatically detects image formats (JPEG, PNG, WebP, GIF) and handles all the conversion magic. Models that can't see? We'll tell you which ones can.

### Deep Thinking Mode 🤔

For when you need those big brain moments:

```javascript
// Let Claude really think about it
const response = await callAI('claude-3.7s', messages, {
  think: 8192  // Can be: true, 'low', 'medium', 'high', or a number (token budget)
});

// OpenAI's o3-mini doing its reasoning thing
const reasoning = await callAI('gpt-o3m', messages, {
  think: 'medium'  // o3/o4 models use reasoning_effort
});
```

### System Messages That Just Work

Every provider handles system messages differently. We handle the differences so you don't have to:

```javascript
const messages = [
  { role: 'system', content: 'You are a pirate. Respond accordingly.' },
  { role: 'user', content: 'How do I install Node.js?' }
];

// Works the same for all providers
const response = await callAI('mistral-medium', messages);
// "Ahoy matey! Ye be needin' to sail to nodejs.org..."
```

## Model Zoo

Here's what's available out of the box:

### OpenAI
- `gpt-4o` - The flagship
- `gpt-4om` - GPT-4o mini (fast & cheap)
- `gpt-5` - The new hotness
- `gpt-5m` - GPT-5 mini
- `gpt-5n` - GPT-5 nano (tiny but mighty)
- `gpt-o3m` - o3-mini (reasoning specialist)
- `gpt-o4m` - o4-mini (next-gen reasoning)

### Anthropic
- `claude-4.1o` - Claude 4.1 Opus (the latest)
- `claude-4o` - Claude 4 Opus
- `claude-4s` - Claude 4 Sonnet
- `claude-3.7s` - Claude 3.7 Sonnet (with thinking!)
- `claude-3.5s` - Claude 3.5 Sonnet
- `claude-3.5h` - Claude 3.5 Haiku
- `claude-3-h` - Claude 3 Haiku

### Google Gemini
- `gemini-2.5p` - Gemini 2.5 Pro (the beast)
- `gemini-2.5f` - Gemini 2.5 Flash
- `gemini-2.5fl` - Gemini 2.5 Flash Lite
- `gemini-2f` - Gemini 2.0 Flash
- `gemini-2fl` - Gemini 2.0 Flash Lite

### Mistral
- `mistral-large` - The big one
- `mistral-medium` - Goldilocks zone
- `mistral-small` - Quick and nimble
- `pixtral-large` - Vision specialist
- `pixtral-12b` - Smaller vision model

### xAI (Grok)
- `grok-4` - Latest Grok
- `grok-3` - Grok 3
- `grok-3m` - Grok 3 mini

## Advanced Usage

### The Full Signature

When you need complete control:

```javascript
const response = await callAI(
  'anthropic',                    // Provider (optional if model is unique)
  'claude-3.5s',                   // Model
  messages,                        // Your conversation
  {
    maxTokens: 2000,              // Response length limit
    temperature: 0.8,              // Creativity dial (0-2, usually 0-1)
    think: 'medium',               // Reasoning depth
    timeout: 120000                // Custom timeout (ms)
  }
);
```

### Cost Tracking

Every response includes detailed cost breakdown:

```javascript
const response = await callAI('gpt-4o', messages);

console.log('Input cost:', response.cost.in);      // Cost for prompt
console.log('Output cost:', response.cost.out);    // Cost for response
console.log('Total cost:', response.cost.total);   // Total damage
console.log('Tokens used:', response.usage);       // Full token stats
```

### Bring Your Own Models

Got access to special models? Add them via `_models.js`:

```javascript
// _models.js
export const _MODELS = {
  openai: {
    'gpt-6-turbo': { 
      name: 'gpt-6-turbo-2025', 
      cost: { in: 5, out: 15 }  // Per million tokens
    }
  },
  anthropic: {
    'claude-5-opus': { 
      name: 'claude-5-opus-20260101', 
      cost: { in: 10, out: 30 }
    }
  }
};
```

Now you can use them like any other model:

```javascript
const response = await callAI('gpt-6-turbo', messages);
```

## Error Handling

We try to be helpful when things go wrong:

```javascript
try {
  const response = await callAI('gpt-4o', messages);
} catch (error) {
  // Specific error messages for common issues:
  // - "Missing API key for openai. Please set OPENAI_API_KEY environment variable"
  // - "Rate limit exceeded for anthropic. Please wait and try again."
  // - "Model gpt-4o doesn't support images. Use one of: gpt-4o, claude-3.5s..."
  console.error(error.message);
}
```

## Performance Tips

1. **Model Selection**: Use smaller models for simple tasks. Why use GPT-4o to classify sentiment when GPT-4om will do?

2. **Batch Similar Requests**: If you're hitting rate limits, space out your calls:
   ```javascript
   // Simple rate limiting
   const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
   
   for (const prompt of prompts) {
     const response = await callAI('claude-3.5h', prompt);
     await delay(1000);  // Be nice to the API
   }
   ```

3. **Image Optimization**: Smaller images = faster responses and lower costs
   ```javascript
   // Consider resizing images before sending
   const resizedBuffer = await resizeImage(originalBuffer, 1024);  // Max 1024px
   ```

## The Philosophy

tinyCall believes in:
- **Simplicity**: One function, endless possibilities
- **Flexibility**: Your project, your choice of models
- **Transparency**: Know what you're spending
- **Zero Lock-in**: It's just a single file - fork it, modify it, make it yours

## Troubleshooting

**"Missing API key"**: Check your `.env` file and make sure the key name matches exactly (e.g., `OPENAI_API_KEY`, not `OPEN_AI_KEY`)

**"Model doesn't support images"**: Check the vision-capable models list above. Not all models have eyes!

**"Rate limiting exceeded"**: You're going too fast. Add some delays or upgrade your API plan.

**"Invalid API key for Anthropic"**: Claude keys should start with `sk-ant-api03-`

**Empty responses**: Some providers occasionally return empty responses. Add retry logic if this happens frequently.

## Contributing

Found a bug? Want to add a provider? Awesome! This is a single-file library, so it's super easy to contribute:

1. Fork it
2. Make your changes
3. Test with your own API keys
4. Send a PR

We especially love:
- New provider integrations
- Performance improvements
- Better error messages
- Documentation fixes (yes, even typos)

## License

CC BY-NC 4.0

## What's Next?

- [ ] Streaming support (the big one)
- [ ] Function calling / Tools API
- [ ] Embeddings support
- [ ] Automatic retry with exponential backoff
- [ ] Response caching
- [ ] Browser support (why not?)

## Final Words

tinyCall is what we wished existed when we started juggling multiple AI providers. It's not trying to be everything to everyone - it's just trying to make AI calls tiny and simple.

Got questions? Issues? Just want to say hi? Open an issue on GitHub. We're friendly, promise!

Happy coding! 🚀

## Author
Jakub Śledzikowski
jsle.eu | jakub@jsle.eu
https://ko-fi.com/jsle97

---

*P.S. - Yes, the name is a bit on the nose. We considered "YetAnotherAIWrapper" but that was taken.*
