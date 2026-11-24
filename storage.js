import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.env.DATA_DIR || './data');
const localDir = path.join(dataDir, 'objects');
fs.mkdirSync(localDir, { recursive: true });

const bucket = process.env.S3_BUCKET;
let s3;
let PutObjectCommand;
let GetObjectCommand;
let Upload;
if (bucket) {
  const [{ S3Client, PutObjectCommand: PutCommand, GetObjectCommand: GetCommand }, { Upload: S3Upload }] = await Promise.all([
    import('@aws-sdk/client-s3'),
    import('@aws-sdk/lib-storage')
  ]);
  s3 = new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    credentials: process.env.S3_ACCESS_KEY_ID ? {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || ''
    } : undefined
  });
  PutObjectCommand = PutCommand;
  GetObjectCommand = GetCommand;
  Upload = S3Upload;
}

function localPath(key) {
  const resolved = path.resolve(localDir, key);
  if (!resolved.startsWith(`${localDir}${path.sep}`)) throw new Error('Invalid storage key');
  return resolved;
}

export async function putFile(key, filePath, contentType) {
  if (s3) {
    await new Upload({
      client: s3,
      params: { Bucket: bucket, Key: key, Body: fs.createReadStream(filePath), ContentType: contentType },
      queueSize: 3,
      partSize: 8 * 1024 * 1024,
      leavePartsOnError: false
    }).done();
  } else {
    const destination = localPath(key);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    await fs.promises.copyFile(filePath, destination);
  }
}

export async function putBuffer(key, buffer, contentType) {
  if (s3) await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: contentType }));
  else {
    const destination = localPath(key);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    await fs.promises.writeFile(destination, buffer);
  }
}

export async function downloadFile(key, destination) {
  if (s3) {
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(destination);
      response.Body.pipe(output);
      output.on('finish', resolve);
      output.on('error', reject);
      response.Body.on('error', reject);
    });
  } else {
    await fs.promises.copyFile(localPath(key), destination);
  }
}

export async function readBuffer(key) {
  if (!s3) return fs.promises.readFile(localPath(key));
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await response.Body.transformToByteArray());
}

export async function getStream(key) {
  if (!s3) return fs.createReadStream(localPath(key));
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return response.Body;
}
