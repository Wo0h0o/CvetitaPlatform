import { Card, CardBody } from "@/components/shared/Card";
import { Megaphone, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";

export default function AdsPage() {
  return (
    <>
    <PageHeader title="Рекламен Отчет" />
    <Card>
      <CardBody>
        <div className="text-center py-16">
          <div className="w-14 h-14 rounded-2xl bg-orange-soft flex items-center justify-center mx-auto mb-4">
            <Megaphone size={24} className="text-orange" />
          </div>
          <h2 className="text-[18px] font-semibold text-text mb-2">
            Рекламен Отчет
          </h2>
          <p className="text-[14px] text-text-2 max-w-md mx-auto mb-6">
            ROAS, CPA, spend и impressions от Meta Ads и Google Ads по кампания.
          </p>
          <div className="bg-surface-2 rounded-xl p-4 max-w-sm mx-auto text-left">
            <p className="text-[12px] font-medium text-text mb-2">За активиране:</p>
            <ol className="text-[12px] text-text-2 space-y-1.5">
              <li className="flex items-start gap-2">
                <ArrowRight size={12} className="mt-0.5 flex-shrink-0 text-accent" />
                Meta Business → Marketing API → Generate Token
              </li>
              <li className="flex items-start gap-2">
                <ArrowRight size={12} className="mt-0.5 flex-shrink-0 text-accent" />
                Google Ads → API access → OAuth credentials
              </li>
              <li className="flex items-start gap-2">
                <ArrowRight size={12} className="mt-0.5 flex-shrink-0 text-accent" />
                Добави ключовете в Vercel → Redeploy
              </li>
            </ol>
          </div>
        </div>
      </CardBody>
    </Card>
    </>
  );
}
