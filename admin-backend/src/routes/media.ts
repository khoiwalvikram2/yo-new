import { FastifyInstance, FastifyRequest } from 'fastify'
import multipart from '@fastify/multipart'
import { hasPermission } from '@/domains/common/auth.js'
import { buildAuthContext } from '@/domains/common/auth.js'
import { getCurrentWhitelabel } from '@/stores/whitelabelStore.js'
import { writeFile, mkdir } from 'fs/promises'
import { join, extname } from 'path'
import { existsSync } from 'fs'
import { randomBytes } from 'crypto'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/svg+xml', 'image/webp']
const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']

// Storage adapter interface
interface StorageAdapter {
  save(file: Buffer, filename: string, contentType: string): Promise<{ url: string; alt?: string }>
}

// Local file storage adapter
class LocalStorageAdapter implements StorageAdapter {
  private basePath: string
  private baseUrl: string

  constructor(basePath: string = './uploads', baseUrl: string = '/uploads') {
    this.basePath = basePath
    this.baseUrl = baseUrl
  }

  async save(file: Buffer, filename: string, contentType: string): Promise<{ url: string; alt?: string }> {
    // Ensure uploads directory exists
    if (!existsSync(this.basePath)) {
      await mkdir(this.basePath, { recursive: true })
    }

    // Generate unique filename
    const ext = extname(filename)
    const uniqueName = `${randomBytes(16).toString('hex')}${ext}`
    const filePath = join(this.basePath, uniqueName)

    // Write file
    await writeFile(filePath, file)

    // Return URL
    const url = `${this.baseUrl}/${uniqueName}`
    return { url, alt: filename.replace(ext, '') }
  }
}

// Get storage adapter based on environment
function getStorageAdapter(): StorageAdapter {
  return new LocalStorageAdapter(
    process.env.MEDIA_UPLOAD_PATH || './uploads',
    process.env.MEDIA_BASE_URL || '/uploads'
  )
}

export async function registerMediaRoutes(app: FastifyInstance) {
  // Register multipart support
  await app.register(multipart, {
    limits: {
      fileSize: MAX_FILE_SIZE,
    },
  })

  app.post('/api/media/upload', async (request: FastifyRequest, reply) => {
    try {
      // Build auth context
      const wlabel = await getCurrentWhitelabel({ request })
      const tenant = wlabel.id || 'default'
      const auth = await buildAuthContext(request, tenant)

      // Check permission
      if (!hasPermission(auth.permissions ?? [], 'payments.pgsettings', 'update')) {
        return reply.code(403).send({ success: false, message: 'Insufficient permissions' })
      }

      const data = await request.file()
      if (!data) {
        return reply.code(400).send({ success: false, message: 'No file provided' })
      }

      // Validate file type
      if (!ALLOWED_TYPES.includes(data.mimetype)) {
        return reply.code(400).send({ 
          success: false, 
          message: `Invalid file type. Allowed: ${ALLOWED_TYPES.join(', ')}` 
        })
      }

      // Validate extension
      const ext = extname(data.filename)
      if (!ALLOWED_EXTENSIONS.includes(ext.toLowerCase())) {
        return reply.code(400).send({ 
          success: false, 
          message: `Invalid file extension. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}` 
        })
      }

      // Read file buffer
      const buffer = await data.toBuffer()

      // Validate size
      if (buffer.length > MAX_FILE_SIZE) {
        return reply.code(400).send({ 
          success: false, 
          message: `File too large. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB` 
        })
      }

      // Save file
      const storage = getStorageAdapter()
      const result = await storage.save(buffer, data.filename, data.mimetype)

      return {
        success: true,
        url: result.url,
        alt: result.alt || data.filename.replace(ext, ''),
      }
    } catch (error: any) {
      request.log.error('Media upload error:', error)
      return reply.code(500).send({ 
        success: false, 
        message: error.message || 'Failed to upload file' 
      })
    }
  })
}

