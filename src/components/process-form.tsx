import { saveProcess } from '@/app/actions/processes';
import { Card, CardBody, CardHeader, Button, Field, inputClass } from './ui';

export interface ProcessFormValues {
  id?: string;
  name: string;
  description: string;
  departmentId: string;
  owner: string;
  trigger: string;
  frequency: string;
  employeesInvolved: string;
  hoursPerWeek: string;
  avgDurationMins: string;
  volumePerPeriod: string;
  inputs: string;
  outputs: string;
  errorRate: string;
  errorImpact: string;
  delayDescription: string;
  customerImpact: string;
  revenueImpact: string;
  manualScore: string;
  repetitivenessScore: string;
  dataReadiness: string;
  riskLevel: string;
  systemsUsed: string;
}

const FREQUENCIES = ['CONTINUOUS', 'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL', 'AD_HOC'];
const IMPACTS = ['NONE', 'LOW', 'MEDIUM', 'HIGH'];
const RISKS = ['LOW', 'MEDIUM', 'HIGH'];

function label(value: string): string {
  const text = value.replace(/_/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function ScaleField({
  name,
  value,
  labelText,
  help,
}: {
  name: string;
  value: string;
  labelText: string;
  help: string;
}) {
  return (
    <Field label={labelText} help={help}>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <label
            key={n}
            className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface text-[13px] font-medium text-ink transition hover:bg-raised has-[:checked]:border-brand has-[:checked]:bg-brand has-[:checked]:text-brandInk"
          >
            <input
              type="radio"
              name={name}
              value={n}
              defaultChecked={value === String(n)}
              className="sr-only"
            />
            {n}
          </label>
        ))}
      </div>
    </Field>
  );
}

export function ProcessForm({
  organisationId,
  departments,
  values,
}: {
  organisationId: string;
  departments: { id: string; name: string }[];
  values: ProcessFormValues;
}) {
  return (
    <form action={saveProcess} className="space-y-6">
      <input type="hidden" name="organisationId" value={organisationId} />
      {values.id ? <input type="hidden" name="processId" value={values.id} /> : null}

      <Card>
        <CardHeader title="What the process is" />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Process name" required>
              <input name="name" defaultValue={values.name} className={inputClass} required />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Description">
              <textarea name="description" rows={3} defaultValue={values.description} className={inputClass} />
            </Field>
          </div>
          <Field label="Department">
            <select name="departmentId" defaultValue={values.departmentId} className={inputClass}>
              <option value="">Not assigned</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Process owner">
            <input name="owner" defaultValue={values.owner} className={inputClass} />
          </Field>
          <Field label="What triggers it" help="The event that starts this process.">
            <input name="trigger" defaultValue={values.trigger} className={inputClass} />
          </Field>
          <Field label="Systems used" help="Comma separated, or one per line.">
            <input name="systemsUsed" defaultValue={values.systemsUsed} className={inputClass} />
          </Field>
          <Field label="Inputs">
            <input name="inputs" defaultValue={values.inputs} className={inputClass} />
          </Field>
          <Field label="Outputs">
            <input name="outputs" defaultValue={values.outputs} className={inputClass} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Time and volume"
          description="These figures are what let the platform size the opportunity. Weekly hours is the single most useful one."
        />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <Field label="Hours per week" help="Across everyone involved.">
            <input
              type="number"
              step="any"
              min="0"
              name="hoursPerWeek"
              defaultValue={values.hoursPerWeek}
              className={`${inputClass} tabular`}
            />
          </Field>
          <Field label="Frequency">
            <select name="frequency" defaultValue={values.frequency} className={inputClass}>
              <option value="">Not recorded</option>
              {FREQUENCIES.map((frequency) => (
                <option key={frequency} value={frequency}>
                  {label(frequency)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="People involved">
            <input
              type="number"
              min="0"
              name="employeesInvolved"
              defaultValue={values.employeesInvolved}
              className={`${inputClass} tabular`}
            />
          </Field>
          <Field label="Volume per period" help="How many times it runs each period.">
            <input
              type="number"
              step="any"
              min="0"
              name="volumePerPeriod"
              defaultValue={values.volumePerPeriod}
              className={`${inputClass} tabular`}
            />
          </Field>
          <Field label="Average duration (minutes)" help="Per occurrence. Used if weekly hours is blank.">
            <input
              type="number"
              step="any"
              min="0"
              name="avgDurationMins"
              defaultValue={values.avgDurationMins}
              className={`${inputClass} tabular`}
            />
          </Field>
          <Field label="Error rate (%)" help="Share of this work that has to be corrected or redone.">
            <input
              type="number"
              step="any"
              min="0"
              max="100"
              name="errorRate"
              defaultValue={values.errorRate}
              className={`${inputClass} tabular`}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="How suitable it is for automation"
          description="These scores adjust the estimated reduction range. Answer honestly — overstating them produces figures you cannot defend."
        />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <ScaleField
            name="manualScore"
            value={values.manualScore}
            labelText="How manual is it?"
            help="1 = fully automated already, 5 = entirely done by hand."
          />
          <ScaleField
            name="repetitivenessScore"
            value={values.repetitivenessScore}
            labelText="How repetitive is it?"
            help="1 = every case is different, 5 = the same every time."
          />
          <ScaleField
            name="dataReadiness"
            value={values.dataReadiness}
            labelText="How good is the data?"
            help="1 = scattered and unreliable, 5 = clean, consistent and in one place."
          />
          <Field label="Risk level" help="How much harm a mistake in this process would cause.">
            <select name="riskLevel" defaultValue={values.riskLevel || 'LOW'} className={inputClass}>
              {RISKS.map((risk) => (
                <option key={risk} value={risk}>
                  {label(risk)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Customer impact">
            <select name="customerImpact" defaultValue={values.customerImpact} className={inputClass}>
              <option value="">Not recorded</option>
              {IMPACTS.map((impact) => (
                <option key={impact} value={impact}>
                  {label(impact)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Revenue impact">
            <select name="revenueImpact" defaultValue={values.revenueImpact} className={inputClass}>
              <option value="">Not recorded</option>
              {IMPACTS.map((impact) => (
                <option key={impact} value={impact}>
                  {label(impact)}
                </option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="What errors cost when they happen">
              <textarea name="errorImpact" rows={2} defaultValue={values.errorImpact} className={inputClass} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Where delays happen">
              <textarea
                name="delayDescription"
                rows={2}
                defaultValue={values.delayDescription}
                className={inputClass}
              />
            </Field>
          </div>
        </CardBody>
      </Card>

      <div className="flex gap-2">
        <Button type="submit" tone="primary">
          {values.id ? 'Save process' : 'Create process'}
        </Button>
      </div>
    </form>
  );
}
