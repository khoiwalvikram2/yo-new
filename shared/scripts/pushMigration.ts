import 'dotenv/config'
import { spawn } from 'child_process'
import { Readable } from 'stream'

const proc = spawn('npx', ['drizzle-kit', 'push', '--config=drizzle.config.ts'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: true,
  cwd: process.cwd()
})

let output = ''
let confirmed = false

// Collect stdout to detect prompt
proc.stdout?.on('data', (data: Buffer) => {
  const text = data.toString()
  output += text
  process.stdout.write(text)
  
  // Detect the prompt and auto-confirm
  if (text.includes('Yes, I want to execute all statements') && !confirmed) {
    confirmed = true
    setTimeout(() => {
      proc.stdin?.write('Yes\n')
      proc.stdin?.end()
    }, 500)
  }
})

proc.stderr?.on('data', (data: Buffer) => {
  process.stderr.write(data)
})

// Fallback: send Yes after 5 seconds if prompt detected
setTimeout(() => {
  if (!confirmed && output.includes('Yes, I want to execute all statements')) {
    confirmed = true
    proc.stdin?.write('Yes\n')
    proc.stdin?.end()
  }
}, 5000)

proc.on('exit', (code) => {
  process.exit(code || 0)
})

proc.on('error', (err) => {
  console.error('Error:', err)
  process.exit(1)
})

