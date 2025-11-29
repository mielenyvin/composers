// vite.config.js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import FullReload from 'vite-plugin-full-reload'
import { spawn } from 'node:child_process'
import path from 'node:path'

const timelineSources = [
  path.resolve('knightlab-timeline/composers.md'),
  path.resolve('knightlab-timeline/timeline.source.json'),
]

function runTimelineBuild() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [path.resolve('scripts/buildTimeline.js')], {
      stdio: 'inherit',
    })
    proc.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`timeline build failed with code ${code}`))
      }
    })
  })
}

function timelineBuilderPlugin() {
  return {
    name: 'timeline-builder',
    async buildStart() {
      await runTimelineBuild()
    },
    configureServer(server) {
      const rebuild = async () => {
        try {
          await runTimelineBuild()
          server.ws.send({ type: 'full-reload' })
        } catch (err) {
          console.error(err)
        }
      }

      server.watcher.add(timelineSources)
      server.watcher.on('change', (file) => {
        const normalized = path.resolve(file)
        if (timelineSources.includes(normalized)) {
          rebuild()
        }
      })

      // Initial rebuild on dev server start
      rebuild()
    },
  }
}

export default defineConfig({
  plugins: [
    vue(),
    timelineBuilderPlugin(),
    FullReload([
      'public/timeline/dist/**',
      'public/timeline/timeline.json',
      'knightlab-timeline/composers.md',
      'knightlab-timeline/timeline.source.json',
    ])
  ],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
})
