import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import StakePageHeader from '@/components/StakePageHeader'
import { usePageSEO } from '../hooks/usePageSEO'
import { useAppIdentity } from '../hooks/useAppSettings'
import '@/styles/account/legal.css'

export default function PrivacyPage() {
  usePageSEO({ title: 'Privacy Policy' })
  const { t } = useTranslation()
  const { supportEmail, supportPhone } = useAppIdentity()
  const supportContact = supportEmail || supportPhone
  const backToTop = t('privacy.backToTop')
  const contentsLabel = t('privacy.contents')
  return (
    <div className="nova-legal space-y-4 pb-6" id="top">
      <StakePageHeader title={t('privacy.title')} />

      <nav aria-label="Table of contents" className="rounded-xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] p-4">
        <div className="text-sm font-semibold text-[color:var(--ds-color-slate-100)] mb-2">{contentsLabel}</div>
        <ul className="grid md:grid-cols-2 gap-2 text-sm">
          <li><a className="hover:underline text-[color:var(--ds-color-slate-300)] hover:text-[#fbbf24]" href="#overview">1. Overview</a></li>
          <li><a className="hover:underline text-[color:var(--ds-color-slate-300)] hover:text-[#fbbf24]" href="#data">2. Data We Collect</a></li>
          <li><a className="hover:underline text-[color:var(--ds-color-slate-300)] hover:text-[#fbbf24]" href="#use">3. How We Use Data</a></li>
          <li><a className="hover:underline text-[color:var(--ds-color-slate-300)] hover:text-[#fbbf24]" href="#share">4. Sharing of Information</a></li>
          <li><a className="hover:underline text-[color:var(--ds-color-slate-300)] hover:text-[#fbbf24]" href="#security">5. Security</a></li>
          <li><a className="hover:underline text-[color:var(--ds-color-slate-300)] hover:text-[#fbbf24]" href="#rights">6. Your Rights</a></li>
          <li><a className="hover:underline text-[color:var(--ds-color-slate-300)] hover:text-[#fbbf24]" href="#retention">7. Data Retention</a></li>
          <li><a className="hover:underline text-[color:var(--ds-color-slate-300)] hover:text-[#fbbf24]" href="#cookies">8. Cookies & Tracking</a></li>
          <li><a className="hover:underline text-[color:var(--ds-color-slate-300)] hover:text-[#fbbf24]" href="#international">9. International Transfers</a></li>
          <li><a className="hover:underline text-[color:var(--ds-color-slate-300)] hover:text-[#fbbf24]" href="#children">10. Children’s Privacy</a></li>
          <li><a className="hover:underline text-[color:var(--ds-color-slate-300)] hover:text-[#fbbf24]" href="#changes">11. Changes to this Policy</a></li>
          <li><a className="hover:underline text-[color:var(--ds-color-slate-300)] hover:text-[#fbbf24]" href="#contact">12. Contact Us</a></li>
        </ul>
      </nav>

      <section id="overview" className="space-y-3">
        <div className="p-4 sm:p-5 rounded-xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] space-y-3">
          <h2 className="text-xl font-semibold text-[color:var(--ds-color-slate-100)]">1. Overview</h2>
          <p className="leading-relaxed text-[color:var(--ds-color-slate-200)]">Your privacy matters. We process personal data in accordance with applicable data protection laws and principles such as lawfulness, fairness, transparency, purpose limitation, and data minimization.</p>
          <div className="text-xs text-[color:var(--ds-color-slate-450)] text-right"><a className="hover:underline" href="#top">{backToTop}</a></div>
        </div>
      </section>

      <section id="data" className="space-y-3">
        <div className="p-4 sm:p-5 rounded-xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] space-y-3">
          <h2 className="text-xl font-semibold text-[color:var(--ds-color-slate-100)]">2. Data We Collect</h2>
          <ul className="list-disc pl-5 space-y-1 leading-relaxed text-[color:var(--ds-color-slate-200)]">
            <li>Account and contact details you provide (e.g., name, email).</li>
            <li>Usage and device data (e.g., IP address, browser, pages visited).</li>
            <li>Transaction data required to process deposits and withdrawals.</li>
            <li>Verification data for compliance with KYC/AML obligations.</li>
          </ul>
          <div className="text-xs text-[color:var(--ds-color-slate-450)] text-right"><a className="hover:underline" href="#top">{backToTop}</a></div>
        </div>
      </section>

      <section id="use" className="space-y-3">
        <div className="p-4 sm:p-5 rounded-xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] space-y-3">
          <h2 className="text-xl font-semibold text-[color:var(--ds-color-slate-100)]">3. How We Use Data</h2>
          <ul className="list-disc pl-5 space-y-1 leading-relaxed text-[color:var(--ds-color-slate-200)]">
            <li>Provide, maintain, and improve our services and features.</li>
            <li>Protect the platform, prevent fraud, and ensure compliance.</li>
            <li>Communicate updates, promotions, and service-related messages.</li>
            <li>Personalize content and recommendations where permitted.</li>
          </ul>
          <div className="text-xs text-[color:var(--ds-color-slate-450)] text-right"><a className="hover:underline" href="#top">{backToTop}</a></div>
        </div>
      </section>

      <section id="share" className="space-y-3">
        <div className="p-4 sm:p-5 rounded-xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] space-y-3">
          <h2 className="text-xl font-semibold text-[color:var(--ds-color-slate-100)]">4. Sharing of Information</h2>
          <p className="leading-relaxed text-[color:var(--ds-color-slate-200)]">We do not sell personal data. We may share limited data with service providers, payment processors, analytics partners, and authorities where required by law or to protect rights and safety.</p>
          <div className="text-xs text-[color:var(--ds-color-slate-450)] text-right"><a className="hover:underline" href="#top">{backToTop}</a></div>
        </div>
      </section>

      <section id="security" className="space-y-3">
        <div className="p-4 sm:p-5 rounded-xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] space-y-3">
          <h2 className="text-xl font-semibold text-[color:var(--ds-color-slate-100)]">5. Security</h2>
          <p className="leading-relaxed text-[color:var(--ds-color-slate-200)]">We employ technical and organizational safeguards appropriate to the risk. Nonetheless, no method of transmission or storage is completely secure.</p>
          <div className="text-xs text-[color:var(--ds-color-slate-450)] text-right"><a className="hover:underline" href="#top">{backToTop}</a></div>
        </div>
      </section>

      <section id="rights" className="space-y-3">
        <div className="p-4 sm:p-5 rounded-xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] space-y-3">
          <h2 className="text-xl font-semibold text-[color:var(--ds-color-slate-100)]">6. Your Rights</h2>
          <p className="leading-relaxed text-[color:var(--ds-color-slate-200)]">Depending on your jurisdiction, you may have rights to access, rectify, erase, restrict or object to processing, and data portability. You may also withdraw consent at any time where processing is based on consent.</p>
          <div className="text-xs text-[color:var(--ds-color-slate-450)] text-right"><a className="hover:underline" href="#top">{backToTop}</a></div>
        </div>
      </section>

      <section id="retention" className="space-y-3">
        <div className="p-4 sm:p-5 rounded-xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] space-y-3">
          <h2 className="text-xl font-semibold text-[color:var(--ds-color-slate-100)]">7. Data Retention</h2>
          <p className="leading-relaxed text-[color:var(--ds-color-slate-200)]">We retain personal data only as long as necessary for the purposes described in this Policy, including legal, accounting, and reporting requirements.</p>
          <div className="text-xs text-[color:var(--ds-color-slate-450)] text-right"><a className="hover:underline" href="#top">{backToTop}</a></div>
        </div>
      </section>

      <section id="cookies" className="space-y-3">
        <div className="p-4 sm:p-5 rounded-xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] space-y-3">
          <h2 className="text-xl font-semibold text-[color:var(--ds-color-slate-100)]">8. Cookies & Tracking</h2>
          <p className="leading-relaxed text-[color:var(--ds-color-slate-200)]">We use cookies and similar technologies to operate the site, analyze usage, and personalize content. You can control cookies via your browser settings.</p>
          <div className="text-xs text-[color:var(--ds-color-slate-450)] text-right"><a className="hover:underline" href="#top">{backToTop}</a></div>
        </div>
      </section>

      <section id="international" className="space-y-3">
        <div className="p-4 sm:p-5 rounded-xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] space-y-3">
          <h2 className="text-xl font-semibold text-[color:var(--ds-color-slate-100)]">9. International Transfers</h2>
          <p className="leading-relaxed text-[color:var(--ds-color-slate-200)]">Where data is transferred internationally, we implement appropriate safeguards consistent with applicable laws.</p>
          <div className="text-xs text-[color:var(--ds-color-slate-450)] text-right"><a className="hover:underline" href="#top">{backToTop}</a></div>
        </div>
      </section>

      <section id="children" className="space-y-3">
        <div className="p-4 sm:p-5 rounded-xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] space-y-3">
          <h2 className="text-xl font-semibold text-[color:var(--ds-color-slate-100)]">10. Children’s Privacy</h2>
          <p className="leading-relaxed text-[color:var(--ds-color-slate-200)]">Our services are not directed to minors. We do not knowingly collect personal data from children. If you believe a child has provided data, contact us to delete it.</p>
          <div className="text-xs text-[color:var(--ds-color-slate-450)] text-right"><a className="hover:underline" href="#top">{backToTop}</a></div>
        </div>
      </section>

      <section id="changes" className="space-y-3">
        <div className="p-4 sm:p-5 rounded-xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] space-y-3">
          <h2 className="text-xl font-semibold text-[color:var(--ds-color-slate-100)]">11. Changes to this Policy</h2>
          <p className="leading-relaxed text-[color:var(--ds-color-slate-200)]">We may update this Policy periodically. Material changes will be communicated where appropriate. Your continued use of the services after changes indicates acceptance.</p>
          <div className="text-xs text-[color:var(--ds-color-slate-450)] text-right"><a className="hover:underline" href="#top">{backToTop}</a></div>
        </div>
      </section>

      <section id="contact" className="space-y-3">
        <div className="p-4 sm:p-5 rounded-xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] space-y-3">
          <h2 className="text-xl font-semibold text-[color:var(--ds-color-slate-100)]">12. Contact Us</h2>
          <p className="leading-relaxed text-[color:var(--ds-color-slate-200)]">
            If you have questions about this Policy or our practices,{' '}
            {supportContact ? (
              <>
                contact us at{' '}
                <a
                  className="text-[var(--brand-primary)] hover:underline"
                  href={supportEmail ? `mailto:${supportEmail}` : `tel:${supportPhone}`}
                >
                  {supportContact}
                </a>
                .
              </>
            ) : (
              <>contact the platform operator through the support details provided with your account.</>
            )}
          </p>
          <div className="text-xs text-[color:var(--ds-color-slate-450)] text-right"><a className="hover:underline" href="#top">{backToTop}</a></div>
        </div>
      </section>

      <div className="pt-2 text-sm text-[color:var(--ds-color-slate-450)]">Also see our <Link to="/terms" className="text-[#fbbf24] hover:underline">Terms and Conditions</Link>.</div>
    </div>
  )
}


