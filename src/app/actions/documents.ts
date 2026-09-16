'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { unlink } from 'node:fs/promises';
import { prisma } from '@/lib/db';
import { requireOrg } from '@/lib/tenancy';
import { recordAudit } from '@/lib/audit';
import { processDocument, storeUpload } from '@/lib/documents/pipeline';
import { snapshotKnowledgeModel } from '@/lib/engine/knowledge-model';

const MAX_BYTES = 20 * 1024 * 1024;

export async function uploadDocuments(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const ctx = await requireOrg(organisationId, 'documents.upload');

  const files = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    redirect(`/app/${organisationId}/documents?error=${encodeURIComponent('Choose at least one file')}`);
  }

  let processed = 0;
  let failed = 0;
  const messages: string[] = [];

  for (const file of files) {
    if (file.size > MAX_BYTES) {
      failed++;
      messages.push(`${file.name} is larger than 20MB`);
      continue;
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const storagePath = await storeUpload(organisationId, file.name, buffer);

    const document = await prisma.document.create({
      data: {
        organisationId,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        storagePath,
        uploadedById: ctx.user.id,
      },
    });

    const outcome = await processDocument(document.id, organisationId);
    if (outcome.status === 'PROCESSED') processed++;
    else {
      failed++;
      if (outcome.warning) messages.push(`${file.name}: ${outcome.warning}`);
    }
  }

  if (processed > 0) {
    await snapshotKnowledgeModel(
      organisationId,
      'DOCUMENT',
      `${processed} document${processed === 1 ? '' : 's'} processed.`,
    );
  }

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: 'documents.upload',
    metadata: { count: files.length, processed, failed },
  });

  revalidatePath(`/app/${organisationId}`, 'layout');

  const query = failed > 0 ? `?error=${encodeURIComponent(messages.join(' · '))}` : '?uploaded=1';
  redirect(`/app/${organisationId}/documents${query}`);
}

export async function reprocessDocument(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const documentId = String(formData.get('documentId'));
  const ctx = await requireOrg(organisationId, 'documents.upload');

  await processDocument(documentId, organisationId);

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: 'documents.reprocess',
    entityType: 'Document',
    entityId: documentId,
  });

  revalidatePath(`/app/${organisationId}/documents`);
}

export async function deleteDocument(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const documentId = String(formData.get('documentId'));
  const ctx = await requireOrg(organisationId, 'documents.upload');

  const document = await prisma.document.findFirst({ where: { id: documentId, organisationId } });
  if (!document) throw new Error('Document not found in this organisation');

  // Remove the file from disk; a missing file must not block the delete.
  try {
    await unlink(document.storagePath);
  } catch {
    /* already gone */
  }

  await prisma.document.delete({ where: { id: documentId } });

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: 'documents.delete',
    entityType: 'Document',
    entityId: documentId,
    metadata: { fileName: document.fileName },
  });

  revalidatePath(`/app/${organisationId}`, 'layout');
}
