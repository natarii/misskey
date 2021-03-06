import * as Koa from 'koa';
import * as send from 'koa-send';
import * as mongodb from 'mongodb';
import DriveFile, { getDriveFileBucket } from '../../models/drive-file';
import DriveFileThumbnail, { getDriveFileThumbnailBucket } from '../../models/drive-file-thumbnail';
import DriveFileWebpublic, { getDriveFileWebpublicBucket } from '../../models/drive-file-webpublic';

const assets = `${__dirname}/../../server/file/assets/`;

const commonReadableHandlerGenerator = (ctx: Koa.Context) => (e: Error): void => {
	console.error(e);
	ctx.status = 500;
};

export default async function(ctx: Koa.Context) {
	// Validate id
	if (!mongodb.ObjectID.isValid(ctx.params.id)) {
		ctx.throw(400, 'incorrect id');
		return;
	}

	const fileId = new mongodb.ObjectID(ctx.params.id);

	// Fetch drive file
	const file = await DriveFile.findOne({ _id: fileId });

	if (file == null) {
		ctx.status = 404;
		await send(ctx, '/dummy.png', { root: assets });
		return;
	}

	if (file.metadata.deletedAt) {
		ctx.status = 410;
		await send(ctx, '/tombstone.png', { root: assets });
		return;
	}

	if (file.metadata.withoutChunks) {
		ctx.status = 204;
		return;
	}

	const sendRaw = async () => {
		if (file.metadata && file.metadata.accessKey && file.metadata.accessKey != ctx.query['original']) {
			ctx.status = 403;
			return;
		}

		const bucket = await getDriveFileBucket();
		const readable = bucket.openDownloadStream(fileId);
		readable.on('error', commonReadableHandlerGenerator(ctx));
		ctx.set('Content-Type', file.contentType);
		ctx.body = readable;
	};

	if ('thumbnail' in ctx.query) {
		const thumb = await DriveFileThumbnail.findOne({
			'metadata.originalId': fileId
		});

		if (thumb != null) {
			ctx.set('Content-Type', 'image/jpeg');
			const bucket = await getDriveFileThumbnailBucket();
			ctx.body = bucket.openDownloadStream(thumb._id);
		} else {
			await sendRaw();
		}
	} else if ('web' in ctx.query) {
		const web = await DriveFileWebpublic.findOne({
			'metadata.originalId': fileId
		});

		if (web != null) {
			ctx.set('Content-Type', file.contentType);

			const bucket = await getDriveFileWebpublicBucket();
			ctx.body = bucket.openDownloadStream(web._id);
		} else {
			await sendRaw();
		}
	} else {
		if ('download' in ctx.query) {
			ctx.set('Content-Disposition', 'attachment');
		}

		await sendRaw();
	}
}
