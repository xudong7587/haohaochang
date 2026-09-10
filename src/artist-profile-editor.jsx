import React, { useState } from "react";
import { Modal } from "./components.jsx";
import { PosterEditor } from "./library/poster-editor.jsx";
import { artistPhotoUrl } from "./artist-artwork.jsx";

export function ArtistProfileEditor({
  profile: initial,
  request,
  token,
  close,
  saved,
}) {
  const [profile, setProfile] = useState(initial),
    [description, setDescription] = useState(initial.description),
    [descriptionSource, setDescriptionSource] = useState(
      initial.descriptionSource,
    ),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  async function run(work) {
    setBusy(true);
    setError("");
    setMessage("正在处理…");
    try {
      await work();
    } catch (e) {
      setError(e.message);
      setMessage("");
    } finally {
      setBusy(false);
    }
  }
  function update(value) {
    setProfile(value);
    saved(value);
  }
  return (
    <Modal
      title={`${profile.artist} · 编辑歌星资料`}
      close={close}
      className="artist-profile-editor"
    >
      <p className="muted">
        照片用于歌星卡片和详情背景，画面会自动裁切适配。也可以挑选
        B站封面或上传自己的图片。
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && !error && (
        <p role="status" className="artist-edit-feedback">
          {message}
        </p>
      )}
      <PosterEditor
        row={{
          id: profile.id,
          metadataRevision: profile.revision,
          hasPoster: profile.hasPhoto,
          posterSource: profile.photoSource,
        }}
        artist={profile.artist}
        title=""
        busy={busy}
        request={request}
        run={run}
        notify={setMessage}
        photoEndpoint={(action) =>
          `/admin/artist-photo/${action}?artist=${encodeURIComponent(profile.artist)}`
        }
        currentImage={profile.hasPhoto ? artistPhotoUrl(profile, token) : ""}
        autoFind={() =>
          request(
            "/admin/artist-photo-search?artist=" +
              encodeURIComponent(profile.artist),
          )
        }
        onSaved={update}
      />
      <div className="artist-bio-editor">
        <label>
          歌星介绍
          <textarea
            rows="5"
            maxLength={2000}
            value={description}
            placeholder="写下这位歌手的音乐风格、代表作品，或你喜欢他的理由。"
            onChange={(event) => {
              setDescription(event.target.value);
              setDescriptionSource("");
            }}
          />
        </label>
        <div className="actions">
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const value = await request(
                  "/admin/artist-description-search?artist=" +
                    encodeURIComponent(profile.artist),
                );
                setDescription(value.description);
                setDescriptionSource(value.sourceUrl);
                setMessage("介绍已放入草稿，请核对后保存");
              })
            }
          >
            查找歌手介绍
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const value = await request(
                  "/admin/artist-profile",
                  {
                    artist: profile.artist,
                    description,
                    descriptionSource,
                    expectedRevision: profile.revision,
                  },
                  "POST",
                );
                update(value);
                setMessage("歌星介绍已保存");
              })
            }
          >
            保存介绍
          </button>
          <span className="muted">{description.length} / 2000</span>
        </div>
      </div>
    </Modal>
  );
}
