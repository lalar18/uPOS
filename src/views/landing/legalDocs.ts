// The public legal pages linked from the landing page footer (see LegalView.vue).
// Each section is a heading with paragraphs and/or a bulleted list.

export const CONTACT_EMAIL = 'sales@usystems.ph'

export type LegalDocId = 'terms' | 'privacy' | 'refunds'

export interface LegalSection {
  heading: string
  paragraphs?: string[]
  list?: string[]
  after?: string[] // paragraphs that follow the list
}

export interface LegalDoc {
  title: string
  summary: string
  updated: string
  sections: LegalSection[]
}

export const legalLinks: { id: LegalDocId; route: string; label: string }[] = [
  { id: 'terms', route: 'terms', label: 'Terms & Conditions' },
  { id: 'privacy', route: 'privacy', label: 'Privacy Policy' },
  { id: 'refunds', route: 'refund-policy', label: 'Return & Refund Policy' },
]

const UPDATED = 'October 11, 2026'

export const legalDocs: Record<LegalDocId, LegalDoc> = {
  terms: {
    title: 'Terms & Conditions',
    summary: 'The rules for using USystems POS. By creating a store or signing in, you agree to them.',
    updated: UPDATED,
    sections: [
      {
        heading: '1. About these terms',
        paragraphs: [
          'These Terms & Conditions ("Terms") govern your use of USystems POS (the "Service"), a web-based point of sale and inventory system operated by USystems ("we", "us", "our"). "You" means the person or business that creates a store on the Service, and every user that store adds.',
          'By signing up, signing in or using the Service, you agree to these Terms, our Privacy Policy and our Return & Refund Policy. If you do not agree, do not use the Service.',
        ],
      },
      {
        heading: '2. Your account',
        list: [
          'You must be at least 18 years old and able to enter into a binding contract to create a store.',
          'You must give accurate information about yourself and your business and keep it up to date.',
          'The person who creates the store is its Admin and is responsible for the users they add, the roles and permissions they give them, and everything done under the store\'s accounts.',
          'Keep your sign-in details secret. Tell us right away at ' + CONTACT_EMAIL + ' if you think someone has used your account without permission.',
        ],
      },
      {
        heading: '3. Free trial',
        paragraphs: [
          'New stores get a free trial of 14 days. No payment is taken during the trial. When it ends, the store becomes view-only until a plan is paid for. We may change or end the free trial offer for new sign-ups at any time.',
        ],
      },
      {
        heading: '4. Plans, billing and renewals',
        list: [
          'Plans are billed monthly in Philippine pesos at the prices shown on our website and on the Subscription page. Each plan has its own limit on users and products.',
          'You renew from the Subscription page. A paid renewal extends your store by one month from its current expiry date, and you may switch plans when you renew.',
          'Renewals paid online go through our payment provider, PayMongo, and may include a service charge, which is shown before you pay.',
          'We may change plan prices or limits. Changes apply from your next renewal, and we will show the new price before you pay.',
          'If your subscription expires, nothing is deleted. Your store becomes view-only until you renew.',
        ],
      },
      {
        heading: '5. Online payments from your customers',
        paragraphs: [
          'If your store accepts online payments (such as GCash, Maya, card or QR Ph) through the Service, those payments are processed by PayMongo and collected into our PayMongo account on your behalf. A service charge, shown to your customer before they pay, may be added on top of the sale amount; it is not part of your sale and is not paid out to you.',
          'The amount of your sales paid online is held in your store\'s wallet until you withdraw it. Withdrawals are sent to the GCash number or bank account you give us. A service charge may be kept out of each withdrawal; it is shown, with the amount you will receive, before you ask for the withdrawal. You are responsible for giving correct payout details; we are not liable for money sent to details you entered incorrectly. We may hold or refuse a withdrawal that we reasonably believe is linked to fraud, a chargeback or a breach of these Terms.',
          'You remain the seller of the goods you sell. You are responsible for your products, prices, receipts, taxes, customer service, and returns and refunds to your customers.',
        ],
      },
      {
        heading: '6. Acceptable use',
        paragraphs: ['You agree not to:'],
        list: [
          'use the Service for anything illegal, including selling prohibited goods or laundering money;',
          'process payments that are fraudulent or that do not come from a real sale;',
          'try to get into accounts, stores or data that are not yours, or test, probe or attack the Service;',
          'copy, resell, reverse engineer or build a competing product from the Service;',
          'upload malicious code or content that infringes someone else\'s rights.',
        ],
        after: ['We may suspend or close a store that breaks these rules.'],
      },
      {
        heading: '7. Your data',
        paragraphs: [
          'The products, sales, customers, suppliers and other records you enter belong to you. You give us permission to store and process them only to run the Service for you, as described in our Privacy Policy. You are responsible for having the right to enter your customers\' personal information into the Service.',
        ],
      },
      {
        heading: '8. Availability and changes',
        paragraphs: [
          'We work to keep the Service available and your data safe, but we do not promise that it will be uninterrupted or error-free. We may update, add or remove features. Planned maintenance will be kept short where we can.',
        ],
      },
      {
        heading: '9. Ending your use',
        paragraphs: [
          'You may stop using the Service at any time by not renewing. To have your store and its data deleted, email us from the Admin\'s email address. We may suspend or end your access if you break these Terms or fail to pay, and we will release any wallet balance that is not subject to a hold.',
        ],
      },
      {
        heading: '10. Disclaimer and limit of liability',
        paragraphs: [
          'The Service is provided "as is". To the extent the law allows, we are not liable for indirect or consequential losses, such as lost profits, lost sales or lost data, and our total liability for any claim is limited to the amount you paid us for the Service in the three months before the claim arose. Nothing in these Terms limits liability that cannot be limited under Philippine law.',
        ],
      },
      {
        heading: '11. Changes to these terms',
        paragraphs: [
          'We may update these Terms. We will post the new version on this page with a new "Last updated" date, and for important changes we will let store Admins know in advance. Continuing to use the Service after a change means you accept it.',
        ],
      },
      {
        heading: '12. Governing law',
        paragraphs: [
          'These Terms are governed by the laws of the Republic of the Philippines. Disputes will be brought before the proper courts of the Philippines.',
        ],
      },
      {
        heading: '13. Contact us',
        paragraphs: ['Questions about these Terms? Email us at ' + CONTACT_EMAIL + '.'],
      },
    ],
  },

  privacy: {
    title: 'Privacy Policy',
    summary: 'What personal information USystems POS collects, why, and how we protect it.',
    updated: UPDATED,
    sections: [
      {
        heading: '1. Who we are',
        paragraphs: [
          'USystems ("we", "us") operates USystems POS. We follow the Data Privacy Act of 2012 (Republic Act No. 10173) and its implementing rules. This policy explains how we handle personal information when you visit our website or use the Service.',
        ],
      },
      {
        heading: '2. Information we collect',
        list: [
          'Account information: your name, email address, profile photo, and, if you sign in with Google, the basic profile Google shares with us (name, email and photo).',
          'Store information: your store\'s name and contact details, and the users, roles and settings you set up.',
          'Business records you enter: products, stock, sales, invoices, quotations, returns, customers and suppliers. Customer and supplier records may contain names, phone numbers, email and addresses.',
          'Payment and payout information: details of subscription renewals and online sale payments (amount, method, reference) from PayMongo, and the GCash number or bank account you give us for withdrawals. We do not receive or store full card numbers.',
          'Technical information: sign-in sessions, IP address, browser type and failed sign-in attempts, used to keep accounts secure.',
        ],
      },
      {
        heading: '3. How we use it',
        list: [
          'to create and run your store account and sign you in;',
          'to process subscription payments, online sale payments and withdrawals;',
          'to protect accounts, for example by limiting repeated failed sign-ins;',
          'to answer your questions and send important notices about your account or these policies;',
          'to meet our legal, tax and accounting obligations.',
        ],
        after: ['We do not sell your personal information, and we do not use your store\'s records for advertising.'],
      },
      {
        heading: '4. Who we share it with',
        paragraphs: ['We share information only with the service providers we need to run the Service, and only what they need:'],
        list: [
          'Cloudflare, which hosts the Service and stores its data;',
          'Google, if you choose to sign in with Google;',
          'PayMongo, which processes online payments and sends withdrawals.',
        ],
        after: [
          'We may also disclose information when the law requires it, or to protect the rights and safety of our users and the Service.',
        ],
      },
      {
        heading: '5. Your customers\' information',
        paragraphs: [
          'For the customer and supplier records a store enters, the store is the personal information controller and we process those records on its behalf. Customers who want to see, correct or delete their information should contact the store directly; we will help the store respond.',
        ],
      },
      {
        heading: '6. Cookies',
        paragraphs: [
          'We use a cookie to keep you signed in and to protect sign-in requests. We do not use advertising or third-party tracking cookies.',
        ],
      },
      {
        heading: '7. How long we keep it',
        paragraphs: [
          'We keep your store\'s data while your account exists, including while it is expired and view-only, so you can renew without losing anything. When you ask us to delete your store, we delete its data, except records we must keep by law, such as payment and tax records, which we keep only as long as required.',
        ],
      },
      {
        heading: '8. How we protect it',
        paragraphs: [
          'Connections to the Service are encrypted (HTTPS). Passwords are stored hashed, never in plain text. Access to store data is limited by store, role and permission, and our staff access it only when needed to support you or run the Service.',
        ],
      },
      {
        heading: '9. Your rights',
        paragraphs: [
          'Under the Data Privacy Act you have the right to be informed, to access, to correct, to object, to erasure or blocking, to data portability, and to file a complaint with the National Privacy Commission. Most of your information can be viewed and changed from your profile and store settings. For anything else, email us at ' +
            CONTACT_EMAIL +
            '.',
        ],
      },
      {
        heading: '10. Children',
        paragraphs: ['The Service is for businesses and is not meant for anyone under 18.'],
      },
      {
        heading: '11. Changes to this policy',
        paragraphs: [
          'We may update this policy. We will post the new version here with a new "Last updated" date and let store Admins know about important changes.',
        ],
      },
      {
        heading: '12. Contact us',
        paragraphs: ['For privacy questions or requests, email ' + CONTACT_EMAIL + '.'],
      },
    ],
  },

  refunds: {
    title: 'Return & Refund Policy',
    summary: 'When subscription payments and online payments can be refunded, and how to ask.',
    updated: UPDATED,
    sections: [
      {
        heading: '1. Free trial first',
        paragraphs: [
          'Every new store gets a 14-day free trial with every feature, and no payment is taken. Please use it to make sure USystems POS fits your store before you pay for a plan.',
        ],
      },
      {
        heading: '2. Subscription payments',
        paragraphs: [
          'USystems POS is a digital service, so there is nothing to return. Monthly plan payments are non-refundable once the renewal has been applied to your store, including for months you do not fully use. If you stop renewing, your store simply becomes view-only when the paid month ends, and nothing is deleted.',
          'We will refund a subscription payment when:',
        ],
        list: [
          'you were charged more than once for the same renewal;',
          'you paid but the renewal was never applied to your store and we cannot fix it;',
          'the Service was unavailable for a long stretch of your paid month because of a problem on our side;',
          'a refund is required by law.',
        ],
      },
      {
        heading: '3. Service charges',
        paragraphs: [
          'Service charges added to online payments are shown before payment and are non-refundable, except when the payment they were charged on is refunded because of a duplicate payment or an error on our side.',
        ],
      },
      {
        heading: '4. Returns and refunds for things bought from a store',
        paragraphs: [
          'Stores that use USystems POS sell their own goods and set their own return policies. If you bought something from a store and want to return it or get a refund, please contact that store. Stores record returns and refunds in USystems POS, but the decision is theirs.',
          'If a customer pays a store online twice for the same sale, the extra payment is flagged and refunded to the customer.',
        ],
      },
      {
        heading: '5. How to ask for a refund',
        paragraphs: [
          'Email ' +
            CONTACT_EMAIL +
            ' within 30 days of the payment with your store name, the date and amount paid, the payment reference, and the reason for your request. We will reply within 5 business days.',
        ],
      },
      {
        heading: '6. How refunds are paid',
        paragraphs: [
          'Approved refunds are sent back through PayMongo to the original payment method (GCash, Maya, card, QR Ph, etc.). Depending on your bank or e-wallet, it can take 5 to 15 business days for the money to show up. Where a refund to the original method is not possible, we will agree on another way with you.',
        ],
      },
      {
        heading: '7. Chargebacks',
        paragraphs: [
          'Please contact us before disputing a charge with your bank. We may pause a store\'s access, and hold its wallet balance, while a chargeback is open.',
        ],
      },
      {
        heading: '8. Contact us',
        paragraphs: ['Questions about this policy? Email us at ' + CONTACT_EMAIL + '.'],
      },
    ],
  },
}
