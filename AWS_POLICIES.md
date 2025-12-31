# AWS Policies Required for VSM App Deployment

## Overview
This document outlines the AWS IAM policies required to deploy the VSM App using the `deploy.sh` script.

## Required Permissions

### 1. S3 Bucket Operations
The user needs permissions to create, list, and upload files to S3 buckets.

### 2. IAM STS (Security Token Service)
The user needs to verify their credentials using STS.

## Minimum IAM Policy

Create an IAM policy with the following permissions:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "S3BucketOperations",
            "Effect": "Allow",
            "Action": [
                "s3:CreateBucket",
                "s3:ListBucket",
                "s3:GetBucketLocation",
                "s3:GetBucketWebsite",
                "s3:PutBucketWebsite",
                "s3:DeleteObject",
                "s3:PutObject",
                "s3:GetObject"
            ],
            "Resource": [
                "arn:aws:s3:::vsmapp-*",
                "arn:aws:s3:::vsmapp-*/*"
            ]
        },
        {
            "Sid": "S3BucketPolicyOperations",
            "Effect": "Allow",
            "Action": [
                "s3:GetBucketPolicy",
                "s3:PutBucketPolicy"
            ],
            "Resource": [
                "arn:aws:s3:::vsmapp-*"
            ]
        },
        {
            "Sid": "STSGetCallerIdentity",
            "Effect": "Allow",
            "Action": [
                "sts:GetCallerIdentity"
            ],
            "Resource": "*"
        }
    ]
}
```

## Policy Breakdown

### S3 Permissions Explained

- **s3:CreateBucket** - Allows creation of new S3 buckets
- **s3:ListBucket** - Allows listing objects in the bucket
- **s3:GetBucketLocation** - Allows reading bucket location
- **s3:GetBucketWebsite** - Allows reading website configuration
- **s3:PutBucketWebsite** - Allows enabling static website hosting
- **s3:GetBucketPolicy** - Allows reading bucket access policies
- **s3:PutBucketPolicy** - Allows setting bucket access policies (for public read access)
- **s3:GetPublicAccessBlock** - Allows reading public access block settings
- **s3:PutBucketPublicAccessBlock** - Allows disabling "Block all public access" setting
- **s3:DeleteObject** - Allows deleting old files during sync
- **s3:PutObject** - Allows uploading new files
- **s3:GetObject** - Allows reading files (for sync verification)

### STS Permission

- **sts:GetCallerIdentity** - Allows the script to verify AWS credentials are valid

## Setting Up IAM User

### Step 1: Create IAM User
```bash
aws iam create-user --user-name vsmapp-deployer
```

### Step 2: Create Access Key
```bash
aws iam create-access-key --user-name vsmapp-deployer
```

### Step 3: Attach Policy
```bash
aws iam put-user-policy --user-name vsmapp-deployer \
    --policy-name vsmapp-deployment \
    --policy-document file://policy.json
```

Replace `policy.json` with a file containing the policy JSON above.

### Step 4: Configure AWS CLI
```bash
aws configure --profile vsmapp
```

You'll be prompted for:
- AWS Access Key ID (from Step 2)
- AWS Secret Access Key (from Step 2)
- Default region (e.g., us-east-1)
- Default output format (json)

### Step 5: Update .env
```bash
cp .env.example .env
```

Edit `.env` and set:
```
AWS_PROFILE=vsmapp
S3_BUCKET_NAME=vsmapp-production
```

## Resource Restriction

The policy above restricts S3 operations to buckets matching the pattern `vsmapp-*`. This is a security best practice to limit the scope of permissions.

If you need to use different bucket names, update the Resource section in the policy:

```json
"Resource": [
    "arn:aws:s3:::my-custom-bucket-name",
    "arn:aws:s3:::my-custom-bucket-name/*"
]
```

## Verification

To verify the user has the correct permissions:

```bash
aws iam list-user-policies --user-name vsmapp-deployer
aws iam get-user-policy --user-name vsmapp-deployer --policy-name vsmapp-deployment
```

## Public Read Access

The policy above includes permissions to manage bucket policies (`s3:GetBucketPolicy` and `s3:PutBucketPolicy`). 

To make your app publicly readable, you need to add a bucket policy. The deployment script automatically applies this policy when it creates or configures the bucket. The public read policy looks like:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "PublicReadGetObject",
            "Effect": "Allow",
            "Principal": "*",
            "Action": "s3:GetObject",
            "Resource": "arn:aws:s3:::vsmapp-production/*"
        }
    ]
}
```

**Note:** This policy allows anyone on the internet to read files from your S3 bucket, which is required for static website hosting.

## Least Privilege Principle

This policy follows the principle of least privilege by:
1. Restricting actions to only what's needed for deployment
2. Limiting S3 resources to specific bucket patterns
3. Not granting any dangerous permissions (e.g., no DeleteBucket, no IAM permissions)
4. Not granting CloudFront, Route53, or other advanced services access

## Additional Resources

- [AWS IAM Policy Simulator](https://policysim.aws.amazon.com/)
- [AWS S3 Actions Reference](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security_iam_service-with-iam.html)
- [AWS STS Actions Reference](https://docs.aws.amazon.com/STS/latest/APIReference/API_Operations.html)
