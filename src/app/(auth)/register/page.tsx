import Link from 'next/link';
import { registerAction } from '@/app/actions/auth';
import { Card, CardBody, Field, inputClass, Button, ErrorText } from '@/components/ui';

export const metadata = { title: 'Create an account' };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <Card>
      <CardBody className="p-6">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Create your account</h1>
        <p className="mt-1 text-[13px] text-muted">
          This creates your organisation and starts your AI business assessment.
        </p>

        <form action={registerAction} className="mt-6 space-y-4">
          {error ? <ErrorText>{error}</ErrorText> : null}

          <Field label="Company name" required>
            <input name="companyName" required className={inputClass} placeholder="Northgate Roofing Ltd" />
          </Field>

          <Field label="Your name" required>
            <input name="name" required autoComplete="name" className={inputClass} />
          </Field>

          <Field label="Email address" required>
            <input name="email" type="email" required autoComplete="email" className={inputClass} />
          </Field>

          <Field label="Password" help="At least 8 characters." required>
            <input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className={inputClass}
            />
          </Field>

          <Button type="submit" className="w-full">
            Create account
          </Button>
        </form>

        <p className="mt-5 text-center text-[13px] text-muted">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-brand hover:underline">
            Sign in
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}
