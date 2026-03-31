import { Card, CardBody } from "@/components/shared/Card";
import { Mail, ArrowRight } from "lucide-react";

export default function EmailPage() {
  return (
    <Card>
      <CardBody>
        <div className="text-center py-16">
          <div className="w-14 h-14 rounded-2xl bg-blue-soft flex items-center justify-center mx-auto mb-4">
            <Mail size={24} className="text-blue" />
          </div>
          <h2 className="text-[18px] font-semibold text-text mb-2">
            Klaviyo Email Dashboard
          </h2>
          <p className="text-[14px] text-text-2 max-w-md mx-auto mb-6">
            Open rate, click rate, revenue от имейл кампании, flow performance и топ кампании.
          </p>
          <div className="bg-surface-2 rounded-xl p-4 max-w-sm mx-auto text-left">
            <p className="text-[12px] font-medium text-text mb-2">За активиране:</p>
            <ol className="text-[12px] text-text-2 space-y-1.5">
              <li className="flex items-start gap-2">
                <ArrowRight size={12} className="mt-0.5 flex-shrink-0 text-accent" />
                Klaviyo → Settings → API Keys → Create Private Key
              </li>
              <li className="flex items-start gap-2">
                <ArrowRight size={12} className="mt-0.5 flex-shrink-0 text-accent" />
                Vercel → Environment Variables → KLAVIYO_PRIVATE_API_KEY
              </li>
              <li className="flex items-start gap-2">
                <ArrowRight size={12} className="mt-0.5 flex-shrink-0 text-accent" />
                Redeploy
              </li>
            </ol>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
