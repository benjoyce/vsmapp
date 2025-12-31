#!/bin/bash

#######################################
# VSM App - AWS Deployment Script
#######################################

set -e

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Functions
print_error() {
    echo -e "${RED}Error: $1${NC}" >&2
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

# Check if .env file exists
if [ ! -f .env ]; then
    print_error ".env file not found"
    echo "Please create a .env file based on .env.example with your AWS credentials"
    exit 1
fi

# Load environment variables
export $(cat .env | grep -v '^#' | xargs)

# Set default AWS profile if not specified
AWS_PROFILE=${AWS_PROFILE:-default}
export AWS_PROFILE

# Validate required variables
required_vars=("S3_BUCKET_NAME")
for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        print_error "Missing required environment variable: $var"
        exit 1
    fi
done

# Check if AWS credentials file exists
if [ ! -f ~/.aws/credentials ]; then
    print_error "AWS credentials file not found at ~/.aws/credentials"
    echo "Please configure AWS credentials using: aws configure"
    exit 1
fi

# Get the AWS region from the profile configuration
AWS_REGION=$(aws configure get region --profile "$AWS_PROFILE" 2>/dev/null)
if [ -z "$AWS_REGION" ]; then
    print_error "AWS region not configured for profile '$AWS_PROFILE'"
    echo "Please set the region using: aws configure --profile $AWS_PROFILE"
    exit 1
fi
export AWS_REGION

print_info "Deploying VSM App to AWS"
print_info "Region: $AWS_REGION"
print_info "S3 Bucket: $S3_BUCKET_NAME"
print_info "App Name: $APP_NAME"
print_info "Environment: $ENVIRONMENT"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    print_info "Installing dependencies..."
    npm install
    print_success "Dependencies installed"
fi

# Build (if needed)
print_info "Preparing application files..."

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    print_error "AWS CLI is not installed. Please install it first."
    echo "Visit: https://aws.amazon.com/cli/"
    exit 1
fi

# Set AWS region
export AWS_DEFAULT_REGION=$AWS_REGION

# Verify AWS credentials by checking STS identity
print_info "Verifying AWS credentials for profile '$AWS_PROFILE'..."
if ! aws sts get-caller-identity --profile "$AWS_PROFILE" > /dev/null 2>&1; then
    print_error "AWS credentials are invalid or expired for profile '$AWS_PROFILE'"
    echo "Please run: aws configure --profile $AWS_PROFILE"
    exit 1
fi
print_success "AWS credentials verified for profile '$AWS_PROFILE'"

# Check if S3 bucket exists
print_info "Checking S3 bucket..."
if aws s3 ls "s3://$S3_BUCKET_NAME" --profile "$AWS_PROFILE" > /dev/null 2>&1; then
    print_success "S3 bucket exists"
else
    print_info "S3 bucket does not exist. Creating..."
    aws s3 mb "s3://$S3_BUCKET_NAME" --region "$AWS_REGION" --profile "$AWS_PROFILE"
    print_success "S3 bucket created"
fi

# Enable static website hosting
print_info "Enabling static website hosting..."
aws s3 website "s3://$S3_BUCKET_NAME" \
    --index-document index.html \
    --error-document index.html \
    --profile "$AWS_PROFILE"
print_success "Static website hosting enabled"

# Disable "Block all public access" to allow public read access
print_info "Disabling 'Block all public access' setting..."
aws s3api put-public-access-block \
    --bucket "$S3_BUCKET_NAME" \
    --public-access-block-configuration \
    "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false" \
    --profile "$AWS_PROFILE"
print_success "Public access allowed"

# Set bucket policy to allow public read access
print_info "Setting bucket policy for public read access..."
cat > /tmp/bucket-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "PublicReadGetObject",
            "Effect": "Allow",
            "Principal": "*",
            "Action": "s3:GetObject",
            "Resource": "arn:aws:s3:::$S3_BUCKET_NAME/*"
        }
    ]
}
EOF

aws s3api put-bucket-policy \
    --bucket "$S3_BUCKET_NAME" \
    --policy file:///tmp/bucket-policy.json \
    --profile "$AWS_PROFILE"
rm /tmp/bucket-policy.json
print_success "Bucket policy set for public access"

# Upload files to S3
print_info "Uploading files to S3..."
aws s3 sync . "s3://$S3_BUCKET_NAME" \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE" \
    --exclude ".git/*" \
    --exclude ".gitignore" \
    --exclude "node_modules/*" \
    --exclude ".env" \
    --exclude ".env.example" \
    --exclude "deploy.sh" \
    --exclude "*.md" \
    --exclude "*.sh" \
    --exclude "package.json" \
    --exclude "package-lock.json" \
    --delete

print_success "Files uploaded to S3"

# Display deployment information
echo ""
print_success "Deployment completed successfully!"
echo ""
echo "Application Details:"
echo "  S3 Bucket: s3://$S3_BUCKET_NAME"
echo "  Region: $AWS_REGION"
echo "  AWS Profile: $AWS_PROFILE"
echo "  Website URL: http://$S3_BUCKET_NAME.s3-website-$AWS_REGION.amazonaws.com"
echo ""
echo "To access your app via HTTPS with a custom domain, configure CloudFront"
echo "To view S3 bucket contents: aws s3 ls s3://$S3_BUCKET_NAME --recursive --profile $AWS_PROFILE"
echo ""
