import { ReactNode } from "react";
import { Card, CardBody } from "@/components/shared/Card";

interface EmptyStateProps {
  icon: React.ElementType;
  iconColor?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  iconColor = "text-blue",
  title,
  description,
  action,
  className = "",
}: EmptyStateProps) {
  const softColor = iconColor.replace("text-", "bg-") + "-soft";

  return (
    <Card className={className}>
      <CardBody>
        <div className="text-center py-12">
          <div
            className={`w-14 h-14 rounded-2xl ${softColor} flex items-center justify-center mx-auto mb-4`}
          >
            <Icon size={24} className={iconColor} />
          </div>
          <p className="text-[15px] font-medium text-text mb-2">{title}</p>
          {description && (
            <p className="text-[13px] text-text-2 max-w-md mx-auto">{description}</p>
          )}
          {action && <div className="mt-4">{action}</div>}
        </div>
      </CardBody>
    </Card>
  );
}
