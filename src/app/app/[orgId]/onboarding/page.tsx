import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireOrg } from '@/lib/tenancy';
import { parseJson } from '@/lib/json';
import { updateBusinessProfile } from '@/app/actions/org';
import { INDUSTRIES } from '@/lib/engine/assessment-template';
import {
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  Button,
  Field,
  inputClass,
  Callout,
  LinkButton,
} from '@/components/ui';

export const metadata = { title: 'Business profile' };

export default async function OnboardingPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { orgId } = await params;
  const { saved } = await searchParams;

  const ctx = await requireOrg(orgId, 'knowledge.edit');
  if (!ctx) notFound();

  const [organisation, profile, departments] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: orgId } }),
    prisma.businessProfile.findFirst({ where: { organisationId: orgId, isCurrent: true } }),
    prisma.department.findMany({ where: { organisationId: orgId }, orderBy: { name: 'asc' } }),
  ]);

  const locations = parseJson<string[]>(profile?.locations, []);

  return (
    <>
      <PageHeader
        eyebrow="Understand the business"
        title="Business profile"
        description="The foundation of everything else. These details shape which questions get asked and how opportunities are valued."
        actions={<LinkButton href={`/app/${orgId}/assessment`}>Go to assessment</LinkButton>}
      />

      {saved ? (
        <div className="mb-5">
          <Callout tone="positive" title="Profile saved">
            Your business knowledge model has been updated and a new version recorded.
          </Callout>
        </div>
      ) : null}

      <form action={updateBusinessProfile} className="space-y-6">
        <input type="hidden" name="organisationId" value={orgId} />

        <Card>
          <CardHeader title="Company" description="Who you are and what you sell." />
          <CardBody className="grid gap-5 sm:grid-cols-2">
            <Field label="Trading name" required>
              <input name="organisationName" defaultValue={organisation.name} className={inputClass} required />
            </Field>
            <Field label="Legal name">
              <input name="legalName" defaultValue={profile?.legalName ?? ''} className={inputClass} />
            </Field>
            <Field label="Industry">
              <select name="industry" defaultValue={profile?.industry ?? ''} className={inputClass}>
                <option value="">Select…</option>
                {INDUSTRIES.map((industry) => (
                  <option key={industry} value={industry}>
                    {industry}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Specific niche" help='For example "commercial roofing" rather than "construction".'>
              <input name="subIndustry" defaultValue={profile?.subIndustry ?? ''} className={inputClass} />
            </Field>
            <Field label="Company size">
              <select name="companySize" defaultValue={profile?.companySize ?? ''} className={inputClass}>
                <option value="">Select…</option>
                {['1-9', '10-49', '50-249', '250-999', '1000+'].map((size) => (
                  <option key={size} value={size}>
                    {size} employees
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Number of employees">
              <input
                type="number"
                min="0"
                name="employeeCount"
                defaultValue={profile?.employeeCount ?? ''}
                className={`${inputClass} tabular`}
              />
            </Field>
            <Field label="Business model">
              <select name="businessModel" defaultValue={profile?.businessModel ?? ''} className={inputClass}>
                <option value="">Select…</option>
                {['B2B', 'B2C', 'B2B2C', 'MARKETPLACE', 'OTHER'].map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Website">
              <input name="website" defaultValue={profile?.website ?? ''} className={inputClass} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Products and services" help="What the business actually sells, in plain terms.">
                <textarea
                  name="productsServices"
                  rows={3}
                  defaultValue={profile?.productsServices ?? ''}
                  className={inputClass}
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Target customers">
                <textarea
                  name="targetCustomers"
                  rows={2}
                  defaultValue={profile?.targetCustomers ?? ''}
                  className={inputClass}
                />
              </Field>
            </div>
            <Field label="Locations" help="One per line.">
              <textarea name="locations" rows={3} defaultValue={locations.join('\n')} className={inputClass} />
            </Field>
            <Field label="Departments" help="One per line. Existing departments are kept.">
              <textarea
                name="departments"
                rows={3}
                defaultValue={departments.map((d) => d.name).join('\n')}
                className={inputClass}
              />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Goals and problems"
            description="What you are trying to achieve, and what is getting in the way."
          />
          <CardBody className="space-y-5">
            <Field label="Biggest goals over the next 12 to 24 months">
              <textarea name="biggestGoals" rows={3} defaultValue={profile?.biggestGoals ?? ''} className={inputClass} />
            </Field>
            <Field label="Biggest problems right now">
              <textarea
                name="biggestProblems"
                rows={3}
                defaultValue={profile?.biggestProblems ?? ''}
                className={inputClass}
              />
            </Field>
            <Field label="What is limiting growth">
              <textarea
                name="growthLimiters"
                rows={2}
                defaultValue={profile?.growthLimiters ?? ''}
                className={inputClass}
              />
            </Field>
            <Field label="Where employees spend the most time">
              <textarea name="timeSinks" rows={2} defaultValue={profile?.timeSinks ?? ''} className={inputClass} />
            </Field>
            <Field label="What would you like AI to achieve?" help='"I am not sure" is a perfectly normal answer.'>
              <textarea name="aiAmbition" rows={2} defaultValue={profile?.aiAmbition ?? ''} className={inputClass} />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Financial baselines"
            description="These are what turn an opinion into an estimate. Without them the platform reports low confidence rather than guessing."
          />
          <CardBody className="grid gap-5 sm:grid-cols-2">
            <Field label="Currency">
              <select name="currency" defaultValue={profile?.currency ?? 'GBP'} className={inputClass}>
                {['GBP', 'USD', 'EUR'].map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Annual turnover">
              <input
                type="number"
                min="0"
                step="any"
                name="annualTurnover"
                defaultValue={profile?.annualTurnover ?? ''}
                className={`${inputClass} tabular`}
              />
            </Field>
            <Field
              label="Fully-loaded hourly employee cost"
              help="Salary, employer contributions and overheads. Every hour of released capacity is valued using this."
            >
              <input
                type="number"
                min="0"
                step="any"
                name="avgHourlyLabourCost"
                defaultValue={profile?.avgHourlyLabourCost ?? ''}
                className={`${inputClass} tabular`}
              />
            </Field>
            <Field label="Average customer value">
              <input
                type="number"
                min="0"
                step="any"
                name="avgCustomerValue"
                defaultValue={profile?.avgCustomerValue ?? ''}
                className={`${inputClass} tabular`}
              />
            </Field>
            <Field label="Monthly leads or enquiries">
              <input
                type="number"
                min="0"
                name="monthlyLeadVolume"
                defaultValue={profile?.monthlyLeadVolume ?? ''}
                className={`${inputClass} tabular`}
              />
            </Field>
            <Field label="Conversion rate (%)">
              <input
                type="number"
                min="0"
                max="100"
                step="any"
                name="conversionRate"
                defaultValue={profile?.conversionRate ?? ''}
                className={`${inputClass} tabular`}
              />
            </Field>
            <Field label="Realistic AI budget for the next year">
              <input
                type="number"
                min="0"
                step="any"
                name="aiBudget"
                defaultValue={profile?.aiBudget ?? ''}
                className={`${inputClass} tabular`}
              />
            </Field>
          </CardBody>
        </Card>

        <div className="flex gap-2">
          <Button type="submit" tone="primary">
            Save business profile
          </Button>
        </div>
      </form>
    </>
  );
}
