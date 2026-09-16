import { CORE_ASSESSMENT, isQuestionVisible } from '@/lib/engine/assessment-template';
import { PageHeader, Card, CardBody, CardHeader, Badge, DataTable } from '@/components/ui';

export const metadata = { title: 'Assessment templates' };

export default function AdminTemplates() {
  const template = CORE_ASSESSMENT;
  const total = template.sections.reduce((sum, s) => sum + s.questions.length, 0);
  const conditional = template.sections
    .flatMap((s) => s.questions)
    .filter((q) => q.dependsOn).length;

  return (
    <>
      <PageHeader
        title="Assessment templates"
        description="The question bank behind the AI business assessment. Questions are declared as data, so they can be versioned without touching the analysis."
      />

      <div className="mb-5 flex flex-wrap gap-2">
        <Badge tone="brand">{template.key}</Badge>
        <Badge>Version {template.version}</Badge>
        <Badge>{template.sections.length} sections</Badge>
        <Badge>{total} questions</Badge>
        <Badge>{conditional} conditional</Badge>
      </div>

      <div className="space-y-5">
        {template.sections.map((section) => (
          <Card key={section.key}>
            <CardHeader title={section.name} description={section.description} />
            <CardBody>
              <DataTable
                columns={['Question', 'Key', 'Type', 'Required', 'Shown when']}
                rows={section.questions.map((question) => [
                  question.prompt,
                  question.key,
                  question.inputType.toLowerCase(),
                  question.required ? 'yes' : 'no',
                  question.dependsOn
                    ? `${question.dependsOn.questionKey} ${
                        question.dependsOn.includes
                          ? `includes ${question.dependsOn.includes}`
                          : question.dependsOn.equals !== undefined
                            ? `= ${question.dependsOn.equals}`
                            : 'is answered'
                      }`
                    : 'always',
                ])}
                caption="Conditional questions are what stop every business being asked the same thing."
              />
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader title="Branching check" description="A worked example of how the conditions behave." />
          <CardBody>
            <DataTable
              columns={['Scenario', 'tech.crm shown?', 'risk.securityConcerns shown?']}
              rows={[
                [
                  'No systems selected, no sensitive data',
                  String(
                    isQuestionVisible(
                      template.sections.find((s) => s.key === 'technology')!.questions.find((q) => q.key === 'tech.crm')!,
                      {},
                    ),
                  ),
                  String(
                    isQuestionVisible(
                      template.sections.find((s) => s.key === 'risk')!.questions.find((q) => q.key === 'risk.securityConcerns')!,
                      { 'risk.sensitiveData': false },
                    ),
                  ),
                ],
                [
                  'CRM selected, handles sensitive data',
                  String(
                    isQuestionVisible(
                      template.sections.find((s) => s.key === 'technology')!.questions.find((q) => q.key === 'tech.crm')!,
                      { 'tech.categories': ['CRM'] },
                    ),
                  ),
                  String(
                    isQuestionVisible(
                      template.sections.find((s) => s.key === 'risk')!.questions.find((q) => q.key === 'risk.securityConcerns')!,
                      { 'risk.sensitiveData': true },
                    ),
                  ),
                ],
              ]}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
