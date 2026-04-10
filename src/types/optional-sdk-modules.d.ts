declare module '@alicloud/dysmsapi20170525' {
  export interface SendSmsRequestInput {
    phoneNumbers?: string;
    signName?: string;
    templateCode?: string;
    templateParam?: string;
  }

  export class SendSmsRequest {
    phoneNumbers?: string;
    signName?: string;
    templateCode?: string;
    templateParam?: string;
    constructor(input: SendSmsRequestInput);
  }

  export default class Dysmsapi20170525 {
    constructor(config: unknown);
    sendSms(request: SendSmsRequest): Promise<{
      body?: {
        code?: string;
        message?: string;
      };
    }>;
  }
}

declare module '@alicloud/openapi-client' {
  export interface OpenApiConfigInput {
    accessKeyId?: string;
    accessKeySecret?: string;
    endpoint?: string;
  }

  export class Config {
    accessKeyId?: string;
    accessKeySecret?: string;
    endpoint?: string;
    constructor(input: OpenApiConfigInput);
  }
}

declare module 'tencentcloud-sdk-nodejs-sms' {
  export interface SendSmsRequestInput {
    PhoneNumberSet?: string[];
    SmsSdkAppId?: string;
    SignName?: string;
    TemplateId?: string;
    TemplateParamSet?: string[];
  }

  export class SendSmsRequest {
    PhoneNumberSet?: string[];
    SmsSdkAppId?: string;
    SignName?: string;
    TemplateId?: string;
    TemplateParamSet?: string[];
    constructor(input: SendSmsRequestInput);
  }

  export class SmsClient {
    constructor(config: unknown);
    SendSms(request: SendSmsRequestInput): Promise<{
      SendStatusSet?: Array<{
        Code?: string;
        Message?: string;
      }>;
    }>;
  }

  const sdkNamespace: {
    sms?: {
      v20210111?: {
        Client?: typeof SmsClient;
      };
    };
  };

  export default sdkNamespace;
}
