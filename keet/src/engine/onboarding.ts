import { BusinessRepository } from '../db/dynamo/business.js';
import type { Business } from '../types.js';
import { detectLanguage } from '../utils/arabic.js';

export type OnboardingStep = 'welcome' | 'ask_business' | 'ask_currency' | 'ask_question' | 'complete';

interface OnboardingState {
  step: OnboardingStep;
  language: 'ar' | 'en' | 'mixed';
}

/**
 * Manages the first 5 minutes — the make-or-break onboarding.
 * Asks exactly 3 things: business type, currency, and their burning question.
 */
export class OnboardingEngine {
  constructor(private businesses: BusinessRepository) {}

  getWelcomeMessage(language: 'ar' | 'en' | 'mixed'): string {
    if (language === 'ar') {
      return (
        'أهلاً! أنا كيت 👋\n' +
        'مساعدك لإدارة حسابات شغلك.\n' +
        'كل اللي عليك تبعتلي المعاملات وأنا هتابع كل حاجة.\n\n' +
        'بس الأول، شغلك في ايه؟ (مثلاً: "ببيع مواد بناء")'
      );
    }
    return (
      "Hi! I'm Keet 👋\n" +
      "Your business memory assistant.\n" +
      "Just text me your transactions and I'll track everything.\n\n" +
      'First, what does your business do? (e.g., "I sell building materials")'
    );
  }

  getAskCurrencyMessage(language: 'ar' | 'en' | 'mixed', detectedCurrency?: string): string {
    const curr = detectedCurrency || 'EGP';
    if (language === 'ar') {
      return `تمام! العملة ${curr}، صح؟`;
    }
    return `Got it! Your currency is ${curr}, correct?`;
  }

  getAskQuestionMessage(language: 'ar' | 'en' | 'mixed'): string {
    if (language === 'ar') {
      return 'أخيراً — ايه أكتر سؤال نفسك تسأله عن شغلك دلوقتي؟\n(مثلاً: "مين عليه فلوس؟")';
    }
    return 'Last question — what\'s the one thing you wish you could ask your business right now?\n(e.g., "who owes me money?")';
  }

  getCompletionMessage(language: 'ar' | 'en' | 'mixed', question: string): string {
    if (language === 'ar') {
      return (
        'تمام، أنا جاهز! 🚀\n' +
        'ابعتلي أي معاملة وأنا هسجلها.\n' +
        'جرب: "أحمد اخد ١٠ شكاير اسمنت كاش"'
      );
    }
    return (
      "All set! 🚀\n" +
      "Text me any transaction and I'll record it.\n" +
      'Try: "Ahmed bought 10 bags cement, paid cash"'
    );
  }

  async handleOnboardingMessage(
    business: Business,
    message: string,
    step: OnboardingStep
  ): Promise<{ response: string; nextStep: OnboardingStep; businessUpdates?: Partial<Business> }> {
    const lang = business.language_preference || detectLanguage(message);

    switch (step) {
      case 'welcome':
      case 'ask_business': {
        // They told us their business type
        const businessType = message.trim();
        await this.businesses.update(business.id, { business_type: businessType });

        return {
          response: this.getAskCurrencyMessage(lang, business.currency),
          nextStep: 'ask_currency',
          businessUpdates: { business_type: businessType },
        };
      }

      case 'ask_currency': {
        // Accept confirmation or new currency
        const upperMsg = message.trim().toUpperCase();
        const currencyMatch = upperMsg.match(/\b(EGP|SAR|USD|AED|KWD|BHD|QAR|OMR|JOD|IQD|LBP|SYP|MAD|TND|DZD|LYD|SDG)\b/);
        const isConfirmation = /^(yes|yeah|yep|صح|اه|ايوه|أيوه|نعم|ok|okay|correct|y)$/i.test(message.trim());

        let currency = business.currency;
        if (currencyMatch) {
          currency = currencyMatch[1];
          await this.businesses.update(business.id, { currency });
        } else if (!isConfirmation) {
          // They might have typed just a currency code or said no
          if (/^(no|لا|لأ|n)$/i.test(message.trim())) {
            const response = lang === 'ar'
              ? 'طيب، ايه العملة اللي بتستخدمها؟ (مثلاً EGP, SAR, USD)'
              : 'Sure, what currency do you use? (e.g., EGP, SAR, USD)';
            return { response, nextStep: 'ask_currency' };
          }
        }

        return {
          response: this.getAskQuestionMessage(lang),
          nextStep: 'ask_question',
        };
      }

      case 'ask_question': {
        // Their burning question — we acknowledge it and complete onboarding
        await this.businesses.update(business.id, { onboarding_complete: true });

        return {
          response: this.getCompletionMessage(lang, message),
          nextStep: 'complete',
          businessUpdates: { onboarding_complete: true },
        };
      }

      default:
        return {
          response: this.getCompletionMessage(lang, ''),
          nextStep: 'complete',
        };
    }
  }

  determineOnboardingStep(business: Business): OnboardingStep {
    if (business.onboarding_complete) return 'complete';
    if (!business.business_type) return 'ask_business';
    return 'ask_question';
  }
}
