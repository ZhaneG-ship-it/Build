import { prisma } from '@/lib/db';
import { parseJson } from '@/lib/json';
import { savePricingPlan } from '@/app/actions/admin';
import {
  PageHeader,
  Card,
  CardBody,
  CardHeader,
  Button,
  Field,
  inputClass,
  Badge,
  Callout,
} from '@/components/ui';

export const metadata = { title: 'Pricing' };

export default async function AdminPricing({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const { saved } = await searchParams;

  const plans = await prisma.pricingPlan.findMany({
    orderBy: { monthlyPrice: 'asc' },
    include: { _count: { select: { organisations: true } } },
  });

  return (
    <>
      <PageHeader title="Pricing plans" description="Plans that can be assigned to an organisation." />

      {saved ? (
        <div className="mb-5">
          <Callout tone="positive" title="Saved">
            The plan has been recorded.
          </Callout>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {plans.map((plan) => {
          const features = parseJson<string[]>(plan.features, []);
          return (
            <Card key={plan.id}>
              <CardHeader
                title={plan.name}
                description={`${plan.currency} ${plan.monthlyPrice}/month · ${plan._count.organisations} organisation${plan._count.organisations === 1 ? '' : 's'}`}
                action={<Badge tone={plan.isActive ? 'positive' : 'neutral'}>{plan.isActive ? 'Active' : 'Inactive'}</Badge>}
              />
              <CardBody>
                <form action={savePricingPlan} className="grid gap-4 sm:grid-cols-2">
                  <input type="hidden" name="planId" value={plan.id} />
                  <Field label="Name">
                    <input name="name" defaultValue={plan.name} className={inputClass} />
                  </Field>
                  <Field label="Monthly price">
                    <input
                      name="monthlyPrice"
                      type="number"
                      defaultValue={plan.monthlyPrice}
                      className={`${inputClass} tabular`}
                    />
                  </Field>
                  <Field label="Max users">
                    <input
                      name="maxUsers"
                      type="number"
                      defaultValue={plan.maxUsers}
                      className={`${inputClass} tabular`}
                    />
                  </Field>
                  <Field label="Max documents">
                    <input
                      name="maxDocuments"
                      type="number"
                      defaultValue={plan.maxDocuments}
                      className={`${inputClass} tabular`}
                    />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Features" help="One per line.">
                      <textarea
                        name="features"
                        rows={4}
                        defaultValue={features.join('\n')}
                        className={inputClass}
                      />
                    </Field>
                  </div>
                  <div className="flex items-center gap-3 sm:col-span-2">
                    <label className="inline-flex items-center gap-2 text-[13px] text-muted">
                      <input
                        type="checkbox"
                        name="isActive"
                        defaultChecked={plan.isActive}
                        className="h-3.5 w-3.5 accent-[rgb(var(--brand))]"
                      />
                      Active
                    </label>
                    <Button type="submit" tone="secondary">
                      Save
                    </Button>
                  </div>
                </form>
              </CardBody>
            </Card>
          );
        })}

        <Card>
          <CardHeader title="Create a plan" />
          <CardBody>
            <form action={savePricingPlan} className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" required>
                <input name="name" className={inputClass} required />
              </Field>
              <Field label="Monthly price">
                <input name="monthlyPrice" type="number" defaultValue={0} className={`${inputClass} tabular`} />
              </Field>
              <Field label="Max users">
                <input name="maxUsers" type="number" defaultValue={10} className={`${inputClass} tabular`} />
              </Field>
              <Field label="Max documents">
                <input name="maxDocuments" type="number" defaultValue={100} className={`${inputClass} tabular`} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Features" help="One per line.">
                  <textarea name="features" rows={4} className={inputClass} />
                </Field>
              </div>
              <div className="flex items-center gap-3 sm:col-span-2">
                <label className="inline-flex items-center gap-2 text-[13px] text-muted">
                  <input
                    type="checkbox"
                    name="isActive"
                    defaultChecked
                    className="h-3.5 w-3.5 accent-[rgb(var(--brand))]"
                  />
                  Active
                </label>
                <Button type="submit" tone="primary">
                  Create plan
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
