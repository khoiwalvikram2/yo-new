import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getEnv } from '@/config/env.js'
import { randomBytes } from 'crypto'

let s3Client: S3Client | null = null

function getS3Client(): S3Client | null {
  const env = getEnv()
  
  if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    return null
  }
  
  if (!s3Client) {
    s3Client = new S3Client({
      region: env.S3_REGION || 'us-east-1',
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    })
  }
  
  return s3Client
}

export async function generatePresignedUploadUrl(
  fileName: string,
  contentType: string,
  folder: string = 'deposits'
): Promise<{ url: string; key: string }> {
  const env = getEnv()
  const client = getS3Client()
  
  if (!client || !env.S3_BUCKET) {
    throw new Error('S3 is not configured. Please set S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY environment variables.')
  }
  
  // Generate unique key
  const timestamp = Date.now()
  const random = randomBytes(8).toString('hex')
  const extension = fileName.split('.').pop() || 'bin'
  const key = `${folder}/${timestamp}-${random}.${extension}`
  
  // Create presigned URL with CORS headers
  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
    ContentType: contentType,
    // Add CORS headers to allow browser uploads
    Metadata: {
      'x-amz-server-side-encryption': 'AES256',
    },
  })
  
  const expiry = parseInt(env.S3_UPLOAD_EXPIRY_SEC || '3600', 10)
  const url = await getSignedUrl(client, command, { expiresIn: expiry })
  
  return { url, key }
}

export function getS3ObjectUrl(key: string): string {
  const env = getEnv()

  // If bucket missing, return raw key so caller can decide
  if (!env.S3_BUCKET) {
    return key
  }

  const region = env.S3_REGION || 'us-east-1'
  return `https://${env.S3_BUCKET}.s3.${region}.amazonaws.com/${key}`
}

export async function generatePresignedGetUrl(key: string, expirySeconds: number = 3600): Promise<string> {
  const env = getEnv()
  const client = getS3Client()
  
  if (!client || !env.S3_BUCKET) {
    // If client not available, fall back to public URL construction
    return getS3ObjectUrl(key)
  }
  
  const command = new GetObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
  })
  
  return getSignedUrl(client, command, { expiresIn: expirySeconds })
}

/**
 * Upload a file directly to S3 and return the URL
 */
export async function uploadToS3(
  fileContent: Buffer,
  key: string,
  contentType: string
): Promise<string> {
  const env = getEnv()
  const client = getS3Client()
  
  if (!client || !env.S3_BUCKET) {
    throw new Error('S3 is not configured. Please set S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY environment variables.')
  }
  
  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
    Body: fileContent,
    ContentType: contentType,
    Metadata: {
      'x-amz-server-side-encryption': 'AES256',
    },
  })
  
  await client.send(command)
  
  // Return presigned URL for download (valid for 7 days)
  return await generatePresignedGetUrl(key, 7 * 24 * 3600)
}

/**
 * Delete an object from S3 by key. Best-effort: a no-op when S3 is not configured,
 * and a missing object (already gone) is treated as success. Throws only on a real
 * S3 error so callers can log it without it being fatal.
 */
export async function deleteFromS3(key: string): Promise<void> {
  if (!key) return
  const env = getEnv()
  const client = getS3Client()

  if (!client || !env.S3_BUCKET) {
    // S3 not configured (e.g. local dev) — nothing to delete.
    return
  }

  await client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }))
}

/**
 * Upload a file from base64 data to S3 and return the key
 * This bypasses CORS by uploading server-side
 */
export async function uploadFileFromBase64(
  fileName: string,
  contentType: string,
  base64Data: string,
  folder: string = 'deposits'
): Promise<string> {
  const env = getEnv()
  const client = getS3Client()
  
  if (!client || !env.S3_BUCKET) {
    throw new Error('S3 is not configured. Please set S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY environment variables.')
  }
  
  // Remove data URL prefix if present (e.g., "data:image/png;base64,")
  const base64Content = base64Data.includes(',') 
    ? base64Data.split(',')[1] 
    : base64Data
  
  // Convert base64 to buffer
  const fileBuffer = Buffer.from(base64Content, 'base64')
  
  // Generate unique key
  const timestamp = Date.now()
  const random = randomBytes(8).toString('hex')
  const extension = fileName.split('.').pop() || 'bin'
  const key = `${folder}/${timestamp}-${random}.${extension}`
  
  // Upload to S3
  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
    Body: fileBuffer,
    ContentType: contentType,
    Metadata: {
      'x-amz-server-side-encryption': 'AES256',
    },
  })
  
  await client.send(command)
  
  return key
}
