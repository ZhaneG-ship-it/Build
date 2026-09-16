import Link from 'next/link';
import { loginAction } from '@/app/actions/auth';
import { Card, CardBody, Field, inputClass, Button, ErrorText } from '@/components/ui';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <Card>
      <CardBody className="p-6">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Sign in</h1>
        <p className="mt-1 text-[13px] text-muted">Continue with your business assessment.</p>

        <form action={loginAction} className="mt-6 space-y-4">
          {error ? <ErrorText>{error}</ErrorText> : null}

          <Field label="Email address" required>
            <input name="email" type="email" required autoComplete="email" className={inputClass} />
          </Field>

          <Field label="Password" required>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className={inputClass}
            />
          </Field>

          <Button type="submit" className="w-full">
            Sign in
          </Button>
        </form>

        <p className="mt-5 text-center text-[13px] text-muted">
          No account yet?{' '}
          <Link href="/register" className="font-medium text-brand hover:underline">
            Create one
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}
