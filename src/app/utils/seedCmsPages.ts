import { CmsSlug } from "../modules/cms/cms.interface";
import { CmsPage } from "../modules/cms/cms.model";
import { logger } from "./logger";

export const DEFAULT_CMS_CONTENT: Record<CmsSlug, string> = {
  [CmsSlug.privacy]: `<p><strong>Effective Date:</strong> September 2026</p>
<h2>1. Information We Collect</h2>
<p>PixelGrade may collect information that users provide directly, including name, email address, account information, shipping and billing information, support messages, and other information submitted through the platform. We may also collect card images, card information, grading reports, labels, collection data, and other content users upload or create while using PixelGrade.</p>
<h2>2. Card Images and Grading Data</h2>
<p>When users upload or scan trading cards, PixelGrade may process the images and related card information to provide identification, grading estimates, condition analysis, reports, personalized labels, collection features, and related services. We may retain relevant card and grading data to operate, secure, improve, and develop PixelGrade's services and grading technology, subject to applicable law and our data practices.</p>
<h2>3. Automatically Collected Information</h2>
<p>We may automatically collect technical and usage information such as IP address, browser type, device information, pages visited, actions taken within the platform, timestamps, and similar analytics or diagnostic information.</p>
<h2>4. How We Use Information</h2>
<p>We may use information to provide and maintain the PixelGrade platform; process card analyses and grading reports; create personalized labels and slab orders; manage accounts and subscriptions; process payments and shipping; provide customer support; improve product performance and user experience; detect fraud or misuse; communicate service updates; and comply with legal obligations.</p>
<h2>5. Payments and Third-Party Services</h2>
<p>PixelGrade may use third-party providers for services such as payment processing, shipping, hosting, analytics, storage, and other infrastructure. These providers may process information as necessary to perform services on our behalf and are subject to their own terms and privacy practices.</p>
<h2>6. Sharing of Information</h2>
<p>We do not sell personal information to advertisers. We may share information with service providers that help us operate PixelGrade, when a user directs us to share information, in connection with a business transaction, or when required to comply with law, protect rights, prevent fraud, or maintain the security of the platform.</p>
<h2>7. Public Profiles and Shared Content</h2>
<p>Certain PixelGrade features may allow users to create public profiles, grading reports, labels, QR-linked pages, collections, or other content. Information a user chooses to make public may be visible to other users or anyone with access to the relevant link or QR code.</p>
<h2>8. Data Retention and Security</h2>
<p>We retain information for as long as reasonably necessary to provide the services, maintain business and legal records, resolve disputes, enforce agreements, and meet legal obligations. We use reasonable administrative, technical, and organizational safeguards, but no system can guarantee absolute security.</p>
<h2>9. User Choices and Requests</h2>
<p>Users may update certain account information through their account settings. Where required by applicable law, users may also have rights to request access, correction, deletion, or other actions relating to their personal information. Requests may be sent to <a href="mailto:admin@pixelgradeai.com">admin@pixelgradeai.com</a>.</p>
<h2>10. Children's Privacy</h2>
<p>PixelGrade is not intended for children under 13, and we do not knowingly collect personal information from children under 13. If we learn that such information has been collected, we will take reasonable steps to delete it.</p>
<h2>11. Changes to This Policy</h2>
<p>We may update this Privacy Policy from time to time. The updated version will be posted on this page with a revised effective date.</p>
<h2>12. Contact</h2>
<p>Questions about this Privacy Policy or privacy requests can be sent to <a href="mailto:admin@pixelgradeai.com">admin@pixelgradeai.com</a>.</p>`,

  [CmsSlug.terms]: `<p><strong>Effective Date:</strong> September 2026</p>
<h2>1. Acceptance of Terms</h2>
<p>By accessing or using PixelGrade, users agree to these Terms &amp; Conditions and any policies referenced within them. If a user does not agree, they should not use the platform.</p>
<h2>2. PixelGrade Service</h2>
<p>PixelGrade provides tools that may identify, analyze, estimate the condition or grade of, organize, personalize, and create reports or labels for trading cards. PixelGrade may also offer subscriptions, physical card holders or slabs, imaging hardware, shipping, and related services.</p>
<h2>3. Grading Estimates and Condition Reports</h2>
<p>PixelGrade grading results, condition reports, confidence scores, card identification, market information, and similar outputs are estimates generated from the information and images available to the platform. Results are not guaranteed to match PSA, BGS, CGC, TAG, or any other third-party grading company. Different grading companies, buyers, sellers, or collectors may reach different conclusions about the same card.</p>
<h2>4. No Guarantee of Card Value</h2>
<p>PixelGrade does not guarantee the authenticity, market value, resale value, future value, or saleability of any trading card. Pricing, comparable sales, or market information shown on the platform is informational and may change over time.</p>
<h2>5. User Responsibility</h2>
<p>Users are responsible for providing accurate information and clear, complete card images. Users should independently evaluate a card before making purchasing, selling, insurance, or other financial decisions. Users are also responsible for content, names, brands, logos, or other materials they submit for personalized labels or profiles.</p>
<h2>6. Accounts and Acceptable Use</h2>
<p>Users are responsible for maintaining the confidentiality of their account credentials and for activity under their accounts. Users may not misuse the platform, interfere with its operation, attempt unauthorized access, upload unlawful or infringing content, manipulate grading or marketplace information, or use PixelGrade for fraudulent activity.</p>
<h2>7. Intellectual Property</h2>
<p>PixelGrade's software, branding, interfaces, designs, reports, platform technology, and other proprietary materials are owned by or licensed to PixelGrade and are protected by applicable intellectual-property laws. Users retain rights in content they own, subject to the permissions necessary for PixelGrade to provide the requested services.</p>
<h2>8. Personalized Labels and User Content</h2>
<p>By submitting names, logos, images, or other content for a personalized label or profile, the user represents that they have the necessary rights to use that content. PixelGrade may refuse or remove content that appears unlawful, misleading, infringing, abusive, or otherwise inappropriate.</p>
<h2>9. Subscriptions and Payments</h2>
<p>Paid plans, products, and services are billed at the prices shown at checkout or on the applicable pricing page. Subscription features, usage limits, and pricing may vary by plan and may be updated from time to time. Any renewal, cancellation, refund, or trial terms presented during checkout or account management will apply to the applicable purchase.</p>
<h2>10. Physical Products, Shipping, and Fulfillment</h2>
<p>Physical products and slab orders are subject to availability, production, shipping, and fulfillment timelines. Shipping estimates are not guarantees. Users are responsible for providing accurate delivery information. Additional policies shown during checkout may apply.</p>
<h2>11. Third-Party Services</h2>
<p>PixelGrade may integrate with or rely on third-party services, including payment processors, shipping providers, hosting providers, card-data sources, analytics services, and other technology providers. PixelGrade is not responsible for independent third-party services outside its control.</p>
<h2>12. Service Availability and Changes</h2>
<p>We may modify, update, suspend, or discontinue features of PixelGrade as the platform develops. We do not guarantee that every feature will always be available or error-free.</p>
<h2>13. Disclaimer of Warranties</h2>
<p>To the extent permitted by law, PixelGrade is provided on an 'as is' and 'as available' basis without warranties of any kind, whether express or implied. We do not warrant that grading estimates, reports, card data, market information, or other outputs will be error-free or suitable for a particular purpose.</p>
<h2>14. Limitation of Liability</h2>
<p>To the extent permitted by applicable law, PixelGrade and its owners, affiliates, employees, contractors, and service providers will not be liable for indirect, incidental, special, consequential, or punitive damages arising from use of the platform, reliance on grading estimates or reports, transactions involving cards, or use of third-party services.</p>
<h2>15. Changes to These Terms</h2>
<p>We may update these Terms &amp; Conditions from time to time. Continued use of PixelGrade after updated terms are posted constitutes acceptance of the revised terms to the extent permitted by law.</p>
<h2>16. Contact</h2>
<p>Questions regarding these Terms &amp; Conditions can be sent to <a href="mailto:admin@pixelgradeai.com">admin@pixelgradeai.com</a>.</p>`,

  [CmsSlug.about]: `<h1>Welcome to PixelGrade</h1>
<p>PixelGrade is a next-generation self-grading platform for trading cards. Built for collectors and card businesses, our platform lets users analyze their cards, receive detailed condition reports and grade estimates, and create personalized grading labels &mdash; all without sending their cards away.</p>
<h2>What We Do</h2>
<p>PixelGrade analyzes trading cards across four core grading areas:</p>
<ul>
  <li><strong>Centering</strong> &mdash; Analysis of front and back card alignment.</li>
  <li><strong>Corners</strong> &mdash; Inspection for rounding, wear, and damaged corners.</li>
  <li><strong>Edges</strong> &mdash; Analysis for whitening, chipping, and edge wear.</li>
  <li><strong>Surface</strong> &mdash; Detection of scratches, print lines, surface wear, and other visible defects.</li>
</ul>
<h2>Why Collectors Choose PixelGrade</h2>
<p>Whether you're evaluating a card, managing your collection, or creating your own personalized grading label, PixelGrade puts the grading experience in your hands.</p>
<ul>
  <li><strong>Instant Grading</strong> &mdash; Receive an estimated grade and condition analysis in seconds.</li>
  <li><strong>Detailed Condition Reports</strong> &mdash; Review individual grading categories, subgrades, and confidence scores.</li>
  <li><strong>Personalized Grading Labels</strong> &mdash; Create grading labels featuring your own name or brand.</li>
  <li><strong>Physical Slabs</strong> &mdash; Turn your grade into a professional protective card holder without sending your card away.</li>
  <li><strong>Market Pricing</strong> &mdash; Track card values and market information directly through PixelGrade.</li>
</ul>
<h2>Mission Statement</h2>
<blockquote>&ldquo;Our mission is to put grading in the hands of collectors by making card analysis faster, more accessible, and more personalized.&rdquo;</blockquote>
<h2>Contact &amp; Support</h2>
<p>Have questions, feedback, or need help with your account? Contact our support team anytime at <a href="mailto:admin@pixelgradeai.com">admin@pixelgradeai.com</a> or visit our <a href="/contact">Contact Us</a> page.</p>`,
};

/**
 * Seeds or updates CMS pages with the official copy from the implementation brief.
 * If a page is empty or contains legacy demo/placeholder text, it is replaced with
 * the clean default HTML. Any custom admin edits that are not placeholders will
 * remain preserved.
 */
export const seedCmsPages = async () => {
  try {
    for (const slug of Object.values(CmsSlug)) {
      const defaultHtml = DEFAULT_CMS_CONTENT[slug] || "";
      const exists = await CmsPage.findOne({ slug });

      if (!exists) {
        await CmsPage.create({ slug, htmlContent: defaultHtml });
        logger.info(`Seeded CMS page: ${slug}`);
        continue;
      }

      // Check if existing content is empty or contains placeholder text
      const raw = exists.htmlContent?.trim() || "";
      const isPlaceholder =
        !raw ||
        /demo dynamic/i.test(raw) ||
        (raw.toLowerCase().includes("demo") &&
          raw.toLowerCase().includes("admin dashboard"));

      if (isPlaceholder) {
        exists.htmlContent = defaultHtml;
        await exists.save();
        logger.info(`Replaced placeholder CMS page copy with official draft: ${slug}`);
      }
    }
  } catch (error) {
    logger.error("Failed to seed CMS pages", { error });
  }
};
