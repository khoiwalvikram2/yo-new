import { randomBytes } from 'crypto'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getEnv } from '../../config/env.js'

function getS3Client(): S3Client | null {
  const env = getEnv()
  if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    return null
  }

  return new S3Client({
    region: env.S3_REGION || 'ap-south-1',
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  })
}

// Direct upload to S3 (server-side, bypasses CORS)
export async function uploadFileToS3(
  fileBuffer: Buffer,
  fileName: string,
  contentType: string,
  folder: string = 'deposits'
): Promise<{ url: string; key: string }> {
  const env = getEnv()
  const client = getS3Client()

  if (!client || !env.S3_BUCKET) {
    throw new Error('S3 is not configured. Please set S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY.')
  }

  const timestamp = Date.now()
  const random = randomBytes(8).toString('hex')
  const extension = fileName.split('.').pop() || 'bin'
  const key = `${folder}/${timestamp}-${random}.${extension}`

  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
    Body: fileBuffer,
    ContentType: contentType,
  })

  await client.send(command)
  
  const region = env.S3_REGION || 'ap-south-1'
  const url = `https://${env.S3_BUCKET}.s3.${region}.amazonaws.com/${key}`

  return { url, key }
}

export async function generatePresignedUploadUrl(
  fileName: string,
  contentType: string,
  folder: string = 'deposits'
): Promise<{ url: string; key: string }> {
  const env = getEnv()
  const client = getS3Client()

  if (!client || !env.S3_BUCKET) {
    throw new Error('S3 is not configured. Please set S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY.')
  }

  const timestamp = Date.now()
  const random = randomBytes(8).toString('hex')
  const extension = fileName.split('.').pop() || 'bin'
  const key = `${folder}/${timestamp}-${random}.${extension}`

  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
    ContentType: contentType,
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

  const region = env.S3_REGION || 'ap-south-1'
  return `https://${env.S3_BUCKET}.s3.${region}.amazonaws.com/${key}`
}

export async function generatePresignedGetUrl(key: string, expirySeconds: number = 3600): Promise<string | null> {
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
  
  try {
    return await getSignedUrl(client, command, { expiresIn: expirySeconds })
  } catch (error) {
    return getS3ObjectUrl(key)
  }
}

