/**
 * S58-T6: Group edit screen.
 * Lets a group OWNER or ADMIN edit name, description, and cover image.
 *
 * Cover image flow:
 *   1. Tap "Change cover photo" → expo-image-picker opens photo library.
 *   2. If fileSize is available and > 5MB, show Alert and abort (advisory check;
 *      Vercel enforces server-side too).
 *   3. POST /api/groups/:id/cover-image to get a clientToken.
 *   4. Upload directly to Vercel Blob using the clientToken via a raw multipart fetch.
 *      (@vercel/blob/client.upload() doesn't bundle cleanly for React Native,
 *       so we use a raw fetch against the Blob API. See TODO comment below.)
 *   5. On upload success, PATCH /api/groups/:id/cover-image with the returned URL.
 *   6. Display new cover. On any error, show Alert and revert.
 *
 * TODO v2: add crop/resize step before upload.
 */

import * as ImagePicker from "expo-image-picker";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, radius, shadows, spacing } from "@predict-future/ui-tokens";

import { useApiQuery } from "@/hooks/useApiQuery";
import { mobileApi } from "@/lib/api";
import { useSession } from "@/providers/session-provider";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function mimeToExt(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function GroupEditScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const groupId = normalizeParam(params.id);
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.userId ?? null;

  const fetcher = useCallback(
    () => mobileApi.getGroupById(groupId as string),
    [groupId]
  );

  const { data, status, error } = useApiQuery(fetcher, [groupId], {
    enabled: Boolean(groupId),
    errorFallback: "Unable to load group.",
  });

  const group = data
    ? (data as { group: { id: string; name: string; description?: string | null; coverImageUrl?: string | null; ownerId: string; memberships?: Array<{ userId: string; role: string; bannedAt?: string | null }> } }).group ?? null
    : null;

  // Local form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Populate form from loaded group data
  useEffect(() => {
    if (!group) return;
    setName(group.name ?? "");
    setDescription(group.description ?? "");
    setCoverImageUrl(group.coverImageUrl ?? null);
  }, [group]);

  if (!groupId) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Missing group id.</Text>
      </View>
    );
  }

  if (status === "loading" || status === "idle") {
    return (
      <>
        <Stack.Screen options={{ title: "Edit Group", headerShown: true }} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      </>
    );
  }

  if (status === "error" || !group) {
    return (
      <>
        <Stack.Screen options={{ title: "Edit Group", headerShown: true }} />
        <View style={styles.center}>
          <Text style={styles.errorText}>{error ?? "Group not found."}</Text>
        </View>
      </>
    );
  }

  // Auth check: caller must be owner or admin.
  const callerMembership = group.memberships?.find((m) => m.userId === userId);
  const isOwnerOrAdmin =
    callerMembership?.role === "OWNER" || callerMembership?.role === "ADMIN";

  if (!isOwnerOrAdmin) {
    return (
      <>
        <Stack.Screen options={{ title: "Edit Group", headerShown: true }} />
        <View style={styles.center}>
          <Text style={styles.errorText}>Only owners and admins can edit the group.</Text>
        </View>
      </>
    );
  }

  async function handlePickCover() {
    const { status: permStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permStatus !== "granted") {
      Alert.alert(
        "Permission required",
        "Please allow photo library access in Settings to set a cover image."
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.9,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) return;

    const asset = result.assets[0];
    if (!asset?.uri) return;

    // Client-side 5MB check (advisory — skip when fileSize is null per iOS behavior).
    if (asset.fileSize != null && asset.fileSize > MAX_FILE_SIZE_BYTES) {
      Alert.alert(
        "Image too large",
        "Please choose an image under 5MB."
      );
      return;
    }

    const mimeType = asset.mimeType ?? "image/jpeg";
    const ext = mimeToExt(mimeType);
    const filename = `cover.${ext}`;

    setCoverUploading(true);
    try {
      // Step 1: Get client upload token from API.
      const tokenRes = await mobileApi.getGroupCoverImageUploadToken(groupId as string, {
        filename,
        contentType: mimeType,
      });
      const { clientToken } = tokenRes as { clientToken: string; url: string };

      // Step 2: Upload directly to Vercel Blob using the client token.
      // Using raw multipart fetch — @vercel/blob/client.upload() doesn't bundle
      // cleanly in React Native due to Node.js-specific fetch shims.
      // The Vercel Blob client upload API accepts a PUT with the clientToken as
      // a query parameter and the file as the body.
      const uploadResponse = await fetch(
        `https://blob.vercel-storage.com/groups/${groupId}/cover.${ext}?token=${encodeURIComponent(clientToken)}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": mimeType,
            "x-content-type": mimeType,
          },
          body: {
            uri: asset.uri,
            type: mimeType,
            name: filename,
          } as unknown as BodyInit,
        }
      );

      if (!uploadResponse.ok) {
        const errText = await uploadResponse.text().catch(() => "unknown error");
        throw new Error(`Upload failed (${uploadResponse.status}): ${errText}`);
      }

      const uploadData = await uploadResponse.json() as { url?: string };
      const blobUrl = uploadData.url;

      if (!blobUrl) throw new Error("No URL returned from Blob upload.");

      // Step 3: PATCH the group with the resulting URL.
      const patchRes = await mobileApi.updateGroupCoverImage(groupId as string, {
        coverImageUrl: blobUrl,
      });
      const updated = patchRes as { coverImageUrl: string };

      setCoverImageUrl(updated.coverImageUrl);
    } catch (err) {
      Alert.alert(
        "Upload failed",
        "Failed to upload cover image. Please try again."
      );
      console.error("[group-edit] cover upload error:", err);
    } finally {
      setCoverUploading(false);
    }
  }

  async function handleSave() {
    if (name.trim().length < 3) {
      Alert.alert("Error", "Group name must be at least 3 characters.");
      return;
    }
    setSaving(true);
    try {
      await mobileApi.updateGroup(groupId as string, {
        name: name.trim(),
        description: description.trim() || undefined,
      });
      Alert.alert("Saved", "Group updated successfully.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: "Edit Group", headerShown: true }} />
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* Cover image area */}
          <View style={styles.coverSection}>
            {coverImageUrl ? (
              <Image
                source={{ uri: coverImageUrl }}
                style={styles.coverPreview}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.coverPlaceholder}>
                <Ionicons name="image-outline" size={36} color={colors.textMuted} />
                <Text style={styles.coverPlaceholderText}>No cover photo</Text>
              </View>
            )}

            <Pressable
              style={[styles.changeCoverBtn, coverUploading && styles.changeCoverBtnDisabled]}
              onPress={() => void handlePickCover()}
              disabled={coverUploading}
            >
              {coverUploading ? (
                <ActivityIndicator color={colors.surface} size="small" />
              ) : (
                <>
                  <Ionicons name="camera-outline" size={16} color={colors.surface} />
                  <Text style={styles.changeCoverBtnText}>
                    {coverImageUrl ? "Change cover photo" : "Add cover photo"}
                  </Text>
                </>
              )}
            </Pressable>
          </View>

          {/* Name */}
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>Group name</Text>
            <TextInput
              style={styles.textInput}
              value={name}
              onChangeText={setName}
              placeholder="My Awesome Group"
              placeholderTextColor={colors.textMuted}
              maxLength={80}
              autoCapitalize="words"
            />
          </View>

          {/* Description */}
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>Description (optional)</Text>
            <TextInput
              style={[styles.textInput, styles.textArea]}
              value={description}
              onChangeText={setDescription}
              placeholder="What is this group about?"
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={4}
              maxLength={500}
              autoCapitalize="sentences"
            />
          </View>

          {/* Save button */}
          <Pressable
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
            onPress={() => void handleSave()}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color={colors.surface} size="small" />
            ) : (
              <Text style={styles.saveBtnText}>Save Changes</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    textAlign: "center",
  },
  content: {
    padding: spacing.xl,
    paddingBottom: 40,
    gap: spacing.xl,
  },

  // Cover section
  coverSection: {
    gap: spacing.md,
  },
  coverPreview: {
    width: "100%",
    height: 180,
    borderRadius: radius.md,
    backgroundColor: colors.border,
  },
  coverPlaceholder: {
    width: "100%",
    height: 180,
    borderRadius: radius.md,
    backgroundColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  coverPlaceholderText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  changeCoverBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    gap: spacing.xs,
    ...shadows.card,
  },
  changeCoverBtnDisabled: {
    opacity: 0.6,
  },
  changeCoverBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.surface,
  },

  // Fields
  fieldBlock: {
    gap: spacing.xs,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  textInput: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 15,
    color: colors.text,
    ...shadows.card,
  },
  textArea: {
    minHeight: 96,
    textAlignVertical: "top",
  },

  // Save button
  saveBtn: {
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.md,
    ...shadows.card,
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.surface,
  },
});
