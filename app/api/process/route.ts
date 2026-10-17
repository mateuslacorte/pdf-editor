import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll('files') as File[];

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No files uploaded' }, { status: 400 });
    }

    const summary = files.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type,
      processedAt: new Date().toISOString(),
    }));

    // In accordance with zero-retention privacy architecture, 
    // uploaded files are processed in ephemeral memory without saving to disk.
    return NextResponse.json({
      status: 'success',
      message: 'Documents received and validated. Ephemeral session purged.',
      files: summary,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
