import { NextRequest, NextResponse } from "next/server";

const SERVER_SECRET_CODE = (
  process.env.SECRET_VERIFY_CODE ||
  process.env.VERIFICATION_CODE ||
  "VOXSUB2026"
).trim();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const submittedCode =
      typeof body?.code === "string" ? body.code.trim() : "";
    const dynamicConfiguredCode =
      typeof body?.configuredCode === "string"
        ? body.configuredCode.trim()
        : "";

    if (!submittedCode) {
      return NextResponse.json(
        { valid: false, error: "Lütfen doğrulama kodunu girin." },
        { status: 400 }
      );
    }

    const isMatchServerEnv =
      submittedCode.toUpperCase() === SERVER_SECRET_CODE.toUpperCase();
    const isMatchDynamicConfig =
      dynamicConfiguredCode.length > 0 &&
      submittedCode.toUpperCase() === dynamicConfiguredCode.toUpperCase();

    if (isMatchServerEnv || isMatchDynamicConfig) {
      return NextResponse.json({
        valid: true,
        message: "Doğrulama kodu onaylandı!",
      });
    }

    return NextResponse.json(
      {
        valid: false,
        error:
          "Girdiğiniz gizli doğrulama kodu geçersiz. Lütfen yöneticinizden aldığınız kodu kontrol edin.",
      },
      { status: 403 }
    );
  } catch (err: unknown) {
    console.error("[/api/verify-code] Doğrulama Hatası:", err);
    return NextResponse.json(
      { valid: false, error: "Doğrulama işlemi sırasında bir hata oluştu." },
      { status: 500 }
    );
  }
}
