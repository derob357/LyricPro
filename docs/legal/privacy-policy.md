# LyricPro Ai — Privacy Policy

**Effective date:** 2026-03-01
**Last updated:** 2026-05-02

> ⚠️ **DRAFT / TEMPLATE** — this is a starting point that accurately reflects the
> app's current technical data handling. It is **not a substitute for legal review**.
> Have a qualified attorney review and localize this document before public
> launch, especially before App Store / Google Play submission, and before
> collecting data from EU / UK / California residents.

---

## 1. Who we are

LyricPro Ai ("LyricPro", "we", "us") is a music-lyric trivia game operated
by F1systems Inc., registered in Georgia, USA, with support
reachable at **deric@intentionai.ai**.

For GDPR purposes we are the **Data Controller** for personal data collected
through the LyricPro Ai website, mobile apps, and related services
(collectively, the "Service").

## 2. What we collect, and why

| Category | Examples | Purpose | Legal basis (GDPR) |
|---|---|---|---|
| Account info | Email, first name, last name, profile picture URL | Create and authenticate your account | Performance of contract |
| Authentication provider | Supabase user ID, provider (magic link / Google / Apple), sign-in timestamps | Log you in, block unauthorized access | Performance of contract |
| Gameplay data | Scores, answers, rounds played, win/loss record, rank tier, streak counts, favorite genre | Run the game, show leaderboards, power your profile | Performance of contract |
| Purchase data | Stripe customer ID, subscription tier, Golden Notes balance, payment history (last 4 digits of card — **we do not store full card numbers**; Stripe does) | Provide paid features, process refunds | Performance of contract |
| Technical data | IP address, browser / device type, session tokens, cookies for auth | Security, fraud prevention, rate limiting | Legitimate interest |
| Communication | Support emails you send us | Respond to your questions | Legitimate interest |

**We do not:** sell your personal data. Use your data for advertising profiling.
Track you across other sites. Sell or share with brokers.

## 3. How we collect it

- **Directly from you** when you sign up, play, message us, or make a purchase.
- **Automatically** when you use the Service — standard server logs, cookies
  required for authentication, and session information.
- **From third-party auth providers** (Google, Apple) when you choose to sign
  in that way — we receive your email and name.

## 4. Third-party service providers

We use the following sub-processors. By using LyricPro Ai you acknowledge
data is processed by each of them under their own terms.

| Provider | Purpose | Data handled | Location |
|---|---|---|---|
| [Supabase](https://supabase.com) | Database, authentication, file storage | Account info, gameplay data, auth tokens | US |
| [Vercel](https://vercel.com) | Web hosting, serverless compute | All Service traffic | Global edge |
| [Stripe](https://stripe.com) | Payment processing | Card details, billing info | US / EU |
| Google OAuth (optional) | Sign-in | Your Google account email + basic profile | US |
| Apple Sign In (optional) | Sign-in | Your Apple-issued email (or relay email) | US |
| [Umami](https://umami.is) (optional, if enabled) | Privacy-friendly analytics | Anonymous page hit counts | Varies |

## 5. Cookies and local storage

We use:

- **Essential cookies / local storage** for authentication (Supabase session),
  rate limiting, and storing your preferences (e.g. muted sound effects). You
  cannot disable these without breaking sign-in.
- **No advertising cookies** and **no third-party tracking cookies**.

## 6. Cross-device data

If you purchase Golden Notes on the LyricPro Ai website, your balance is
stored in your account and available across all your devices, including the
mobile apps. Mobile apps can display and spend your balance but cannot
purchase new Golden Notes — those purchases happen on the web only.

## 7. How long we keep it

- **Active accounts:** as long as your account is open.
- **Inactive accounts:** 3 years after last sign-in, then we anonymize your
  play records and delete personal identifiers.
- **Payment records:** 7 years (required by tax law in most jurisdictions).
- **Support emails:** 2 years.

## 8. Your rights

You have the right to:

- **Access** a copy of the personal data we hold about you.
- **Correct** inaccurate data.
- **Delete** your account and associated data ("right to be forgotten").
- **Port** your data in a machine-readable format.
- **Restrict or object** to certain processing.
- **Withdraw consent** where processing is based on consent.

To exercise any right, email **deric@intentionai.ai**. We respond within 30
days. If you believe we mishandled a request, you may complain to your local
data protection authority.

California residents: you also have the right to know what categories of
personal information we collect, to opt out of "sales" of personal info (we
don't sell), and equivalent rights under the California Consumer Privacy Act.

## 9. Security

- All traffic to the Service is encrypted over HTTPS / TLS 1.2+.
- Database connections between our servers and Supabase use TLS.
- Passwords are never stored by us directly — authentication is handled by
  Supabase, which uses industry-standard hashing.
- Stripe handles all payment card data; we never see full card numbers.
- We enforce rate limiting and bot protection on authentication endpoints.
- We conduct regular dependency audits and promptly patch high-severity
  vulnerabilities.

No online service is 100% secure. If we become aware of a data breach
affecting your personal information, we will notify you within 72 hours per
GDPR Art. 34 requirements.

## 10. Children's privacy

LyricPro Ai is **not intended for children under 13** (or under 16 in the
EU). If you are under 13 in the US or 16 in the EU, please do not use the
Service and do not send us personal information. If we learn that we have
collected personal data from a child in violation of this rule, we will
delete it promptly.

## 11. Changes to this policy

We may update this policy. If we make material changes, we will notify you
by email (if you have an account) and/or by a prominent notice on the
Service at least 30 days before the change takes effect.

## 12. Contact

Privacy questions, data subject requests, or concerns:

**Email:** deric@intentionai.ai
**Mail:** [COMPANY LEGAL ADDRESS]

For EU / UK data subjects, if we appoint a representative in the EU / UK
under GDPR / UK GDPR, their contact information will be listed here.
