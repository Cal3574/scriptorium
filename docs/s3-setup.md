# S3 upload bucket - one-time dev setup

The reader uploads a PDF straight from the browser to S3 with a presigned
`PUT`, then the API `HEAD`s the object to confirm it landed (see issue #22).
Two one-time setup steps are needed per environment: bucket CORS (so the
browser `PUT` is allowed) and a scoped IAM user (whose keys the API uses to
sign the `PUT` and to `HEAD` the object).

`PROVIDER_MODE=fake` needs none of this - uploads are kept in an in-memory
bucket. Everything below is for `PROVIDER_MODE=live`.

## 1. Create the bucket

```sh
aws s3api create-bucket \
  --bucket scriptorium-uploads-dev \
  --region eu-west-2 \
  --create-bucket-configuration LocationConstraint=eu-west-2

# Block all public access - every object is reached through a presigned URL.
aws s3api put-public-access-block \
  --bucket scriptorium-uploads-dev \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

## 2. Bucket CORS

The browser sends a cross-origin `PUT` with a `Content-Type` header, so the
bucket must allow that method and header from the client origin. `x-amz-*` is
allowed as a safety net in case a future AWS SDK version signs a checksum
header into the presigned PUT (`S3ObjectStorage` sets
`requestChecksumCalculation: 'WHEN_REQUIRED'` to avoid that today). Save as
`cors.json`:

```json
{
  "CORSRules": [
    {
      "AllowedOrigins": ["http://localhost:4200"],
      "AllowedMethods": ["PUT"],
      "AllowedHeaders": ["Content-Type", "x-amz-*"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3000
    }
  ]
}
```

```sh
aws s3api put-bucket-cors --bucket scriptorium-uploads-dev --cors-configuration file://cors.json
```

Add the deployed client origin to `AllowedOrigins` for staging / production
buckets.

## 3. Scoped IAM user

The API only needs to put and head objects under the `books/` prefix. Save as
`policy.json` (substitute the bucket name):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PresignAndVerifyUploads",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:HeadObject"],
      "Resource": "arn:aws:s3:::scriptorium-uploads-dev/books/*"
    }
  ]
}
```

```sh
aws iam create-user --user-name scriptorium-api-dev
aws iam put-user-policy --user-name scriptorium-api-dev \
  --policy-name scriptorium-uploads --policy-document file://policy.json
aws iam create-access-key --user-name scriptorium-api-dev
```

`s3:HeadObject` is covered by `s3:GetObject` permissions but is listed
explicitly for clarity.

## 4. Fill in `.env`

```sh
PROVIDER_MODE=live
S3_BUCKET=scriptorium-uploads-dev
S3_REGION=eu-west-2
AWS_ACCESS_KEY_ID=<from step 3>
AWS_SECRET_ACCESS_KEY=<from step 3>
# S3_ENDPOINT stays blank for real AWS.
```

## Local S3 without AWS (optional)

Point `S3_ENDPOINT` at a MinIO / LocalStack container and use its root
credentials. `S3ObjectStorage` switches to path-style addressing when
`S3_ENDPOINT` is set. Bucket CORS still has to be configured on that service.
