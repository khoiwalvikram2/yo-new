import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import StakePageHeader from '@/components/StakePageHeader'
import { usePageSEO } from '../hooks/usePageSEO'
import { useAppIdentity } from '@/hooks/useAppSettings'
import '@/styles/account/legal.css'

export default function TermsPage() {
  usePageSEO({ title: 'Terms & Conditions' })
  const { t } = useTranslation()
  const { appName } = useAppIdentity()
  const backToTop = t('terms.backToTop')
  const contentsLabel = t('terms.contents')
  return (
    <div className="nova-legal space-y-4 pb-6" id="top">
      <StakePageHeader title={t('terms.title')} />

      <section className="p-4 sm:p-5 rounded-xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] space-y-4">
        <nav aria-label="Table of contents" className="rounded-lg bg-[color:var(--ds-color-slate-750)] border border-[color:var(--ds-color-slate-600)] p-4">
          <div className="text-sm font-semibold text-[color:var(--ds-color-slate-100)] mb-2">{contentsLabel}</div>
          <ul className="grid md:grid-cols-2 gap-2 text-sm text-[color:var(--ds-color-slate-100)]">
            <li><a className="hover:underline text-[color:var(--ds-color-slate-300)] hover:text-[#fbbf24]" href="#acceptance">1. Acceptance of Terms</a></li>
            <li><a className="hover:underline text-[color:var(--ds-color-slate-300)] hover:text-[#fbbf24]" href="#eligibility">2. Eligibility</a></li>
            <li><a className="hover:underline text-[color:var(--ds-color-slate-300)] hover:text-[#fbbf24]" href="#accounts">3. Accounts</a></li>
            <li><a className="hover:underline text-[color:var(--ds-color-slate-300)] hover:text-[#fbbf24]" href="#responsible">4. Responsible Gaming</a></li>
            <li><a className="hover:underline text-[color:var(--ds-color-slate-300)] hover:text-[#fbbf24]" href="#payments">5. Deposits & Withdrawals</a></li>
            <li><a className="hover:underline text-[color:var(--ds-color-slate-300)] hover:text-[#fbbf24]" href="#bonuses">6. Bonuses & Promotions</a></li>
            <li><a className="hover:underline text-[color:var(--ds-color-slate-300)] hover:text-[#fbbf24]" href="#prohibited">7. Prohibited Activities</a></li>
            <li><a className="hover:underline text-[color:var(--ds-color-slate-300)] hover:text-[#fbbf24]" href="#ip">8. Intellectual Property</a></li>
            <li><a className="hover:underline text-[color:var(--ds-color-slate-300)] hover:text-[#fbbf24]" href="#liability">9. Limitation of Liability</a></li>
            <li><a className="hover:underline text-[color:var(--ds-color-slate-300)] hover:text-[#fbbf24]" href="#disclaimer">10. Disclaimer</a></li>
            <li><a className="hover:underline text-[color:var(--ds-color-slate-300)] hover:text-[#fbbf24]" href="#law">11. Governing Law & Disputes</a></li>
            <li><a className="hover:underline text-[color:var(--ds-color-slate-300)] hover:text-[#fbbf24]" href="#changes">12. Changes to Terms</a></li>
          </ul>
        </nav>
      </section>

      <section id="acceptance" className="space-y-3">
        <div className="p-4 sm:p-5 rounded-xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] space-y-3">
          <h2 className="text-xl font-semibold text-[color:var(--ds-color-slate-100)]">1. Acceptance of Terms</h2>
          <p className="leading-relaxed text-[color:var(--ds-color-slate-200)]">By accessing or using {appName}, you agree to be bound by these Terms. If you do not agree, you must not use the services.</p>
          <div className="text-xs text-[color:var(--ds-color-slate-450)] text-right"><a className="hover:underline" href="#top">{backToTop}</a></div>
        </div>
      </section>

      <section id="eligibility" className="space-y-3">
        <div className="p-4 sm:p-5 rounded-xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] space-y-3">
          <h2 className="text-xl font-semibold text-[color:var(--ds-color-slate-100)]">2. Eligibility</h2>
          <p className="leading-relaxed text-[color:var(--ds-color-slate-200)]">You must be of legal age in your jurisdiction and comply with all applicable laws. Access may be restricted in certain territories.</p>
          <div className="text-xs text-[color:var(--ds-color-slate-450)] text-right"><a className="hover:underline" href="#top">{backToTop}</a></div>
        </div>
      </section>

      <section id="accounts" className="space-y-3">
        <div className="p-4 sm:p-5 rounded-xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] space-y-3">
          <h2 className="text-xl font-semibold text-[color:var(--ds-color-slate-100)]">3. Accounts</h2>
          <ul className="list-disc pl-5 space-y-1 leading-relaxed text-[color:var(--ds-color-slate-200)]">
            <li>You are responsible for safeguarding your credentials.</li>
            <li>You must provide accurate information and keep it updated.</li>
            <li>We may suspend or terminate accounts that violate these Terms.</li>
          </ul>
          <div className="text-xs text-[color:var(--ds-color-slate-450)] text-right"><a className="hover:underline" href="#top">{backToTop}</a></div>
        </div>
      </section>

      <section id="responsible" className="space-y-3">
        <div className="p-4 sm:p-5 rounded-xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] space-y-3">
          <h2 className="text-xl font-semibold text-[color:var(--ds-color-slate-100)]">4. Responsible Gaming</h2>
          <p className="leading-relaxed text-[color:var(--ds-color-slate-200)]">Gambling involves risk. Only wager what you can afford to lose. Consider setting limits and seeking support if gambling impacts your wellbeing.</p>
          <div className="text-xs text-[color:var(--ds-color-slate-450)] text-right"><a className="hover:underline" href="#top">{backToTop}</a></div>
        </div>
      </section>

      <section id="payments" className="space-y-3">
        <div className="p-4 sm:p-5 rounded-xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] space-y-3">
          <h2 className="text-xl font-semibold text-[color:var(--ds-color-slate-100)]">5. Deposits & Withdrawals</h2>
          <ul className="list-disc pl-5 space-y-1 leading-relaxed text-[color:var(--ds-color-slate-200)]">
            <li>Your maximum withdrawal limit is 3x your deposit. For example, if you deposit ₹100, you can withdraw up to ₹300.</li>
            <li>Processing times and fees may vary by method and jurisdiction.</li>
            <li>We may request identity verification in line with KYC/AML requirements.</li>
            <li>Suspicious or fraudulent activity may result in holds or reversals.</li>
          </ul>
          <div className="text-xs text-[color:var(--ds-color-slate-450)] text-right"><a className="hover:underline" href="#top">{backToTop}</a></div>
        </div>
      </section>

      <section id="bonuses" className="space-y-3">
        <div className="p-4 sm:p-5 rounded-xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] space-y-3">
          <h2 className="text-xl font-semibold text-[color:var(--ds-color-slate-100)]">6. Bonuses & Promotions</h2>
          <p className="leading-relaxed text-[color:var(--ds-color-slate-200)]">Bonus offers are subject to specific terms, including wagering requirements, eligibility, and expiry. In case of conflict, bonus-specific terms prevail.</p>
          <div className="text-xs text-[color:var(--ds-color-slate-450)] text-right"><a className="hover:underline" href="#top">{backToTop}</a></div>
        </div>
      </section>

      <section id="prohibited" className="space-y-3">
        <div className="p-4 sm:p-5 rounded-xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] space-y-3">
          <h2 className="text-xl font-semibold text-[color:var(--ds-color-slate-100)]">7. Prohibited Activities</h2>
          <ul className="list-disc pl-5 space-y-1 leading-relaxed text-[color:var(--ds-color-slate-200)]">
            <li>Cheating, collusion, or exploiting vulnerabilities.</li>
            <li>Use of bots, automated systems, or multiple accounts.</li>
            <li>Money laundering or other unlawful conduct.</li>
          </ul>
          <div className="text-xs text-[color:var(--ds-color-slate-450)] text-right"><a className="hover:underline" href="#top">{backToTop}</a></div>
        </div>
      </section>

      <section id="ip" className="space-y-3">
        <div className="p-4 sm:p-5 rounded-xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] space-y-3">
          <h2 className="text-xl font-semibold text-[color:var(--ds-color-slate-100)]">8. Intellectual Property</h2>
          <p className="leading-relaxed text-[color:var(--ds-color-slate-200)]">All content, trademarks, and software are owned by {appName} or its licensors. You may not reproduce or distribute materials without permission.</p>
          <div className="text-xs text-[color:var(--ds-color-slate-450)] text-right"><a className="hover:underline" href="#top">{backToTop}</a></div>
        </div>
      </section>

      <section id="liability" className="space-y-3">
        <div className="p-4 sm:p-5 rounded-xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] space-y-3">
          <h2 className="text-xl font-semibold text-[color:var(--ds-color-slate-100)]">9. Limitation of Liability</h2>
          <p className="leading-relaxed text-[color:var(--ds-color-slate-200)]">{appName} is provided on an "as is" and "as available" basis. To the fullest extent permitted by law, we disclaim all warranties and are not liable for indirect, incidental, or consequential damages.</p>
          <div className="text-xs text-[color:var(--ds-color-slate-450)] text-right"><a className="hover:underline" href="#top">{backToTop}</a></div>
        </div>
      </section>

      <section id="disclaimer" className="space-y-3">
        <div className="p-4 sm:p-5 rounded-xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] space-y-3">
          <h2 className="text-xl font-semibold text-[color:var(--ds-color-slate-100)]">10. Disclaimer</h2>
          <p className="leading-relaxed text-[color:var(--ds-color-slate-200)]">We do not guarantee uninterrupted or error-free operation. Market and system conditions may impact availability and outcomes.</p>
          <div className="text-xs text-[color:var(--ds-color-slate-450)] text-right"><a className="hover:underline" href="#top">{backToTop}</a></div>
        </div>
      </section>

      <section id="law" className="space-y-3">
        <div className="p-4 sm:p-5 rounded-xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] space-y-3">
          <h2 className="text-xl font-semibold text-[color:var(--ds-color-slate-100)]">11. Governing Law & Dispute Resolution</h2>
          <p className="leading-relaxed text-[color:var(--ds-color-slate-200)]">These Terms are governed by applicable laws of the relevant jurisdiction. Disputes will be resolved through binding arbitration or the courts designated by {appName}, unless prohibited by law.</p>
          <div className="text-xs text-[color:var(--ds-color-slate-450)] text-right"><a className="hover:underline" href="#top">{backToTop}</a></div>
        </div>
      </section>

      <section id="changes" className="space-y-3">
        <div className="p-4 sm:p-5 rounded-xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] space-y-3">
          <h2 className="text-xl font-semibold text-[color:var(--ds-color-slate-100)]">12. Changes to Terms</h2>
          <p className="leading-relaxed text-[color:var(--ds-color-slate-200)]">We may update these Terms from time to time. Material changes will be communicated where appropriate. Continued use of the platform after changes constitutes acceptance.</p>
          <div className="text-xs text-[color:var(--ds-color-slate-450)] text-right"><a className="hover:underline" href="#top">{backToTop}</a></div>
        </div>
      </section>

      <div className="pt-2 text-sm text-[color:var(--ds-color-slate-450)]">Also see our <Link to="/privacy" className="text-[#fbbf24] hover:underline">Privacy Policy</Link>.</div>
    </div>
  )
}


