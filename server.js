const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');

const execAsync = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3000;

// Gateway config
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://100.116.176.82:18789';
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '3c7f71b5937863d62b8596a3fbcc3c90dac55dd85e89d60d';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Helper to run openclaw commands
async function runOpenClaw(args) {
  try {
    const { stdout } = await execAsync(`openclaw ${args}`);
    return { success: true, output: stdout };
  } catch (error) {
    return { success: false, error: error.message, output: error.stdout };
  }
}

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const gatewayStatus = await runOpenClaw('gateway status');
    res.json({
      success: true,
      gateway: gatewayStatus.success,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// List all agents/sessions
app.get('/api/agents', async (req, res) => {
  try {
    const result = await runOpenClaw('sessions list --json');
    if (!result.success) {
      return res.json({ success: false, error: result.error });
    }
    
    let agents = [];
    try {
      // Parse the JSON output
      const lines = result.output.trim().split('\n').filter(line => line.trim());
      for (const line of lines) {
        try {
          const agent = JSON.parse(line);
          agents.push(agent);
        } catch (e) {
          // Skip non-JSON lines
        }
      }
    } catch (e) {
      console.error('Parse error:', e);
    }
    
    res.json({ success: true, agents });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Send message to agent
app.post('/api/agents/:key/message', async (req, res) => {
  const { key } = req.params;
  const { message, timeout = 60 } = req.body;
  
  try {
    const result = await runOpenClaw(`sessions send "${key}" "${message.replace(/"/g, '\\"')}" --timeout ${timeout}`);
    res.json({ success: result.success, result: result.output, error: result.error });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Kill agent
app.post('/api/agents/:key/kill', async (req, res) => {
  const { key } = req.params;
  
  try {
    // Try to kill via process management or session end
    const result = await runOpenClaw(`sessions send "${key}" "MISSION_COMPLETE - End session now" --timeout 10`);
    res.json({ success: true, message: 'Kill signal sent', result: result.output });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Update agent model
app.post('/api/agents/:key/model', async (req, res) => {
  const { key } = req.params;
  const { model } = req.body;
  
  try {
    const result = await runOpenClaw(`sessions send "${key}" "/model ${model}" --timeout 10`);
    res.json({ success: true, message: `Model change requested: ${model}`, result: result.output });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Spawn new agent
app.post('/api/agents/spawn', async (req, res) => {
  const { task, label, model, timeout = 3600 } = req.body;
  
  try {
    const labelArg = label ? `--label "${label}"` : '';
    const modelArg = model ? `--model "${model}"` : '';
    const result = await runOpenClaw(`sessions spawn "${task.replace(/"/g, '\\"')}" ${labelArg} ${modelArg} --timeout ${timeout}`);
    res.json({ success: result.success, result: result.output, error: result.error });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// List cron jobs
app.get('/api/cron', async (req, res) => {
  try {
    const result = await runOpenClaw('cron list --json');
    let jobs = [];
    try {
      const lines = result.output.trim().split('\n').filter(line => line.trim());
      for (const line of lines) {
        try {
          const job = JSON.parse(line);
          jobs.push(job);
        } catch (e) {}
      }
    } catch (e) {}
    
    res.json({ success: true, jobs });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Emergency: Kill all agents
app.post('/api/emergency/kill-all', async (req, res) => {
  try {
    const result = await runOpenClaw('sessions list --json');
    let count = 0;
    
    const lines = result.output.trim().split('\n').filter(line => line.trim());
    for (const line of lines) {
      try {
        const agent = JSON.parse(line);
        if (agent.key && !agent.key.includes(':main:main')) {
          await runOpenClaw(`sessions send "${agent.key}" "MISSION_COMPLETE - End session now" --timeout 5`);
          count++;
        }
      } catch (e) {}
    }
    
    res.json({ success: true, count, message: `Terminated ${count} agents` });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Emergency: Restart gateway
app.post('/api/emergency/restart-gateway', async (req, res) => {
  try {
    const result = await runOpenClaw('gateway restart');
    res.json({ success: result.success, result: result.output, error: result.error });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Serve the dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'mission-control.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎛️ Mission Control running on http://0.0.0.0:${PORT}`);
  console.log(`🔗 Gateway: ${GATEWAY_URL}`);
});