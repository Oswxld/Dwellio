type PageSkeletonProps = {
  variant: 'dashboard' | 'billing'
}

export default function PageSkeleton({
  variant,
}: PageSkeletonProps) {
  if (variant === 'billing') {
    return (
      <div className="page-skeleton page-skeleton-billing" aria-hidden="true">
        <div className="skeleton-row skeleton-heading-row">
          <Skeleton width="220px" height="30px" />
          <Skeleton width="160px" height="40px" />
        </div>

        <div className="skeleton-row skeleton-controls-row">
          <Skeleton width="240px" height="42px" />
          <Skeleton width="220px" height="42px" />
          <Skeleton width="120px" height="34px" />
        </div>

        <div className="skeleton-card skeleton-workflow">
          <Skeleton width="140px" height="16px" />
          <div className="skeleton-steps">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} height="46px" />
            ))}
          </div>
        </div>

        <div className="skeleton-metrics">
          {Array.from({ length: 4 }).map((_, index) => (
            <div className="skeleton-card" key={index}>
              <Skeleton width="90px" height="14px" />
              <Skeleton width="76px" height="28px" />
              <Skeleton width="120px" height="12px" />
            </div>
          ))}
        </div>

        <div className="skeleton-two-column">
          <div className="skeleton-card skeleton-tall-card">
            <Skeleton width="180px" height="20px" />
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} height="54px" />
            ))}
          </div>

          <div className="skeleton-card skeleton-tall-card">
            <Skeleton width="150px" height="20px" />
            <Skeleton height="90px" />
            <Skeleton height="42px" />
            <Skeleton height="42px" />
          </div>
        </div>

        <div className="skeleton-card">
          <Skeleton width="180px" height="20px" />
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} height="48px" />
          ))}
        </div>

        <SkeletonStyles />
      </div>
    )
  }

  return (
    <div className="page-skeleton page-skeleton-dashboard" aria-hidden="true">
      <div className="skeleton-row skeleton-heading-row">
        <div>
          <Skeleton width="130px" height="12px" />
          <Skeleton width="310px" height="34px" />
          <Skeleton width="360px" height="14px" />
        </div>
        <Skeleton width="130px" height="40px" />
      </div>

      <div className="skeleton-card">
        <Skeleton width="160px" height="18px" />
        <div className="skeleton-attention-row">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} height="82px" />
          ))}
        </div>
      </div>

      <div className="skeleton-metrics">
        {Array.from({ length: 4 }).map((_, index) => (
          <div className="skeleton-card" key={index}>
            <Skeleton width="110px" height="13px" />
            <Skeleton width="84px" height="28px" />
            <Skeleton width="130px" height="12px" />
          </div>
        ))}
      </div>

      <div className="skeleton-two-column">
        <div className="skeleton-card skeleton-tall-card">
          <Skeleton width="170px" height="20px" />
          <Skeleton height="190px" />
        </div>
        <div className="skeleton-card skeleton-tall-card">
          <Skeleton width="150px" height="20px" />
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} height="58px" />
          ))}
        </div>
      </div>

      <SkeletonStyles />
    </div>
  )
}

function Skeleton({
  width = '100%',
  height = '18px',
}: {
  width?: string
  height?: string
}) {
  return (
    <div
      className="skeleton-block"
      style={{ width, height }}
    />
  )
}

function SkeletonStyles() {
  return (
    <style>{`
      .page-skeleton {
        padding: 30px 32px 48px;
        min-height: calc(100vh - 64px);
        background: #edfdf3;
      }

      .skeleton-row {
        display: flex;
        align-items: center;
        gap: 16px;
      }

      .skeleton-heading-row {
        justify-content: space-between;
        margin-bottom: 24px;
      }

      .skeleton-heading-row > div:first-child {
        display: grid;
        gap: 10px;
      }

      .skeleton-controls-row {
        flex-wrap: wrap;
        margin-bottom: 20px;
      }

      .skeleton-card {
        display: grid;
        gap: 14px;
        padding: 20px;
        border: 1px solid #e1ebe5;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.92);
        box-shadow: 0 8px 24px rgba(19, 45, 36, 0.035);
      }

      .skeleton-workflow {
        margin-bottom: 20px;
      }

      .skeleton-steps,
      .skeleton-attention-row,
      .skeleton-metrics,
      .skeleton-two-column {
        display: grid;
        gap: 14px;
      }

      .skeleton-steps {
        grid-template-columns: repeat(5, minmax(0, 1fr));
      }

      .skeleton-attention-row {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .skeleton-metrics {
        grid-template-columns: repeat(4, minmax(0, 1fr));
        margin-bottom: 20px;
      }

      .skeleton-two-column {
        grid-template-columns: minmax(0, 1.4fr) minmax(280px, .8fr);
        margin-bottom: 20px;
      }

      .skeleton-tall-card {
        min-height: 230px;
      }

      .skeleton-block {
        max-width: 100%;
        border-radius: 10px;
        background: linear-gradient(
          100deg,
          #e1ece6 20%,
          #f4faf6 38%,
          #e1ece6 56%
        );
        background-size: 220% 100%;
        animation: dwellio-skeleton-shimmer 1.5s ease-in-out infinite;
      }

      @keyframes dwellio-skeleton-shimmer {
        from { background-position: 100% 0; }
        to { background-position: -100% 0; }
      }

      @media (max-width: 900px) {
        .skeleton-metrics,
        .skeleton-two-column,
        .skeleton-attention-row,
        .skeleton-steps {
          grid-template-columns: 1fr 1fr;
        }
      }

      @media (max-width: 620px) {
        .page-skeleton {
          padding: 22px 18px 36px;
        }

        .skeleton-heading-row {
          align-items: flex-start;
          flex-direction: column;
        }

        .skeleton-metrics,
        .skeleton-two-column,
        .skeleton-attention-row,
        .skeleton-steps {
          grid-template-columns: 1fr;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .skeleton-block {
          animation: none;
        }
      }
    `}</style>
  )
}
