#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { KeetStack } from '../lib/keet-stack';

const app = new cdk.App();

new KeetStack(app, 'KeetStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'me-south-1', // Bahrain — closest to MENA
  },
  description: 'Keet — chat-native business accounting engine',
});
