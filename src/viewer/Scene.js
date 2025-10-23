
import * as THREE from "../../libs/three.js/build/three.module.js";
import {Annotation} from "../Annotation.js";
import {CameraMode} from "../defines.js";
import {View} from "./View.js";
import {Utils} from "../utils.js";
import {EventDispatcher} from "../EventDispatcher.js";


export class Scene extends EventDispatcher{

	constructor(){
		super();

		this.annotations = new Annotation();
		
		this.scene = new THREE.Scene();
		this.sceneBG = new THREE.Scene();
		this.scenePointCloud = new THREE.Scene();

		this.cameraP = new THREE.PerspectiveCamera(this.fov, 1, 0.1, 1000*1000);
		this.cameraO = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000*1000);
		this.cameraVR = new THREE.PerspectiveCamera();
		this.cameraBG = new THREE.Camera();
		this.cameraScreenSpace = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
		this.cameraMode = CameraMode.PERSPECTIVE;
		this.overrideCamera = null;
		this.pointclouds = [];

		this.measurements = [];
		this.profiles = [];
		this.volumes = [];
		this.polygonClipVolumes = [];
		this.cameraAnimations = [];
		this.orientedImages = [];
		this.images360 = [];
		this.geopackages = [];
		
		this.fpControls = null;
		this.orbitControls = null;
		this.earthControls = null;
		this.geoControls = null;
		this.deviceControls = null;
		this.inputHandler = null;

		this.view = new View();

		this.directionalLight = null;

		this.initialize();
	}

	estimateHeightAt (position) {
		let height = null;
		let fromSpacing = Infinity;

		for (let pointcloud of this.pointclouds) {
			if (pointcloud.root.geometryNode === undefined) {
				continue;
			}

			let pHeight = null;
			let pFromSpacing = Infinity;

			let lpos = position.clone().sub(pointcloud.position);
			lpos.z = 0;
			let ray = new THREE.Ray(lpos, new THREE.Vector3(0, 0, 1));

			let stack = [pointcloud.root];
			while (stack.length > 0) {
				let node = stack.pop();
				let box = node.getBoundingBox();

				let inside = ray.intersectBox(box);

				if (!inside) {
					continue;
				}

				let h = node.geometryNode.mean.z +
					pointcloud.position.z +
					node.geometryNode.boundingBox.min.z;

				if (node.geometryNode.spacing <= pFromSpacing) {
					pHeight = h;
					pFromSpacing = node.geometryNode.spacing;
				}

				for (let index of Object.keys(node.children)) {
					let child = node.children[index];
					if (child.geometryNode) {
						stack.push(node.children[index]);
					}
				}
			}

			if (height === null || pFromSpacing < fromSpacing) {
				height = pHeight;
				fromSpacing = pFromSpacing;
			}
		}

		return height;
	}
	
	getBoundingBox(pointclouds = this.pointclouds){
		let box = new THREE.Box3();

		this.scenePointCloud.updateMatrixWorld(true);
		this.referenceFrame.updateMatrixWorld(true);

		for (let pointcloud of pointclouds) {
			pointcloud.updateMatrixWorld(true);

			let pointcloudBox = pointcloud.pcoGeometry.tightBoundingBox ? pointcloud.pcoGeometry.tightBoundingBox : pointcloud.boundingBox;
			let boxWorld = Utils.computeTransformedBoundingBox(pointcloudBox, pointcloud.matrixWorld);
			box.union(boxWorld);
		}

		return box;
	}

	addPointCloud (pointcloud) {
		this.pointclouds.push(pointcloud);
		this.scenePointCloud.add(pointcloud);

		this.dispatchEvent({
			type: 'pointcloud_added',
			pointcloud: pointcloud
		});
	}

	/**
	 * KATAPULT MODIFICATION - 2025-10-23
	 * 
	 * Removes a point cloud from the scene and properly disposes all associated resources.
	 * This includes geometry buffers, materials, textures, and scene nodes.
	 * 
	 * IMPORTANT: This method safely handles shared materials between point clouds.
	 * Materials and their textures are only disposed if no other point cloud references them.
	 * 
	 * @param {PointCloudOctree} pointcloud - The point cloud to remove
	 * 
	 * TODO: Verify this works correctly in production with:
	 *       - Multiple point clouds
	 *       - Shared materials
	 *       - Memory leak testing (check DevTools Memory profiler)
	 *       - Ensure other point clouds remain functional after removal
	 * 
	 * @author Katapult Development
	 */
	removePointCloud(pointcloud) {
		let index = this.pointclouds.indexOf(pointcloud);
		console.log("Removing point cloud:", pointcloud, "at index:", index);
		if (index > -1) {
			// 1. Dispose all geometry nodes in the octree
			if (pointcloud.visibleNodes) {
				for (let node of pointcloud.visibleNodes) {
					if (node.geometryNode && node.geometryNode.geometry) {
						node.geometryNode.geometry.dispose();
					}
				}
			}
			
			// Recursively dispose all nodes in the tree
			if (pointcloud.root) {
				this._disposeNodeRecursive(pointcloud.root);
			}
			
			// 2. Dispose pickState resources if they exist
			if (pointcloud.pickState) {
				if (pointcloud.pickState.renderTarget) {
					pointcloud.pickState.renderTarget.dispose();
				}
				// Check if pickState material is shared before disposing
				if (pointcloud.pickState.material) {
					let pickMaterialIsShared = this.pointclouds.some(pc => 
						pc !== pointcloud && 
						pc.pickState && 
						pc.pickState.material === pointcloud.pickState.material
					);
					if (!pickMaterialIsShared) {
						this._disposeMaterial(pointcloud.pickState.material);
					}
				}
			}
			
			// 3. Dispose the main material and all its textures (only if not shared)
			if (pointcloud.material) {
				// Check if any other point cloud shares this material
				let materialIsShared = this.pointclouds.some(pc => 
					pc !== pointcloud && pc.material === pointcloud.material
				);
				if (!materialIsShared) {
					this._disposeMaterial(pointcloud.material);
				}
			}
			
			// 4. Remove from THREE.js scene hierarchy
			this.scenePointCloud.remove(pointcloud);
			
			// 5. Remove from array
			this.pointclouds.splice(index, 1);
			
			// 6. Dispatch event
			this.dispatchEvent({
				type: 'pointcloud_removed',
				pointcloud: pointcloud
			});
		}
	}

	/**
	 * KATAPULT MODIFICATION - 2025-10-23
	 * 
	 * Helper method to recursively dispose node geometries throughout the octree structure.
	 * Traverses the entire tree and cleans up geometry buffers and scene nodes.
	 * 
	 * @param {PointCloudOctreeNode} node - The node to dispose (recursive)
	 * @private
	 * 
	 * TODO: Verify this properly handles all node types in the octree
	 * 
	 * @author Katapult Development
	 */
	_disposeNodeRecursive(node) {
		if (!node) return;
		
		// Dispose geometry if it exists
		if (node.geometryNode && node.geometryNode.geometry) {
			node.geometryNode.geometry.dispose();
		}
		
		// Remove scene node from parent
		if (node.sceneNode && node.sceneNode.parent) {
			node.sceneNode.parent.remove(node.sceneNode);
		}
		
		// Recursively dispose children
		if (node.children) {
			for (let child of node.children) {
				if (child) {
					this._disposeNodeRecursive(child);
				}
			}
		}
	}

	/**
	 * KATAPULT MODIFICATION - 2025-10-23
	 * 
	 * Helper method to dispose a PointCloudMaterial and all its associated textures.
	 * Cleans up GPU resources for: visibleNodesTexture, gradientTexture, 
	 * matcapTexture, and classificationTexture.
	 * 
	 * WARNING: Only call this if you've verified the material is not shared
	 * with other point clouds using the shared material checks in removePointCloud().
	 * 
	 * @param {PointCloudMaterial} material - The material to dispose
	 * @private
	 * 
	 * TODO: Verify all texture types used by PointCloudMaterial are covered
	 * 
	 * @author Katapult Development
	 */
	_disposeMaterial(material) {
		if (!material) return;
		
		// Dispose textures used by the material
		if (material.visibleNodesTexture) {
			material.visibleNodesTexture.dispose();
		}
		if (material.gradientTexture) {
			material.gradientTexture.dispose();
		}
		if (material.matcapTexture) {
			material.matcapTexture.dispose();
		}
		if (material.classificationTexture) {
			material.classificationTexture.dispose();
		}
		
		// Dispose the material itself
		material.dispose();
	}

	addVolume (volume) {
		this.volumes.push(volume);
		this.dispatchEvent({
			'type': 'volume_added',
			'scene': this,
			'volume': volume
		});
	}

	addOrientedImages(images){
		this.orientedImages.push(images);
		this.scene.add(images.node);

		this.dispatchEvent({
			'type': 'oriented_images_added',
			'scene': this,
			'images': images
		});
	};

	removeOrientedImages(images){
		let index = this.orientedImages.indexOf(images);
		if (index > -1) {
			this.orientedImages.splice(index, 1);

			this.dispatchEvent({
				'type': 'oriented_images_removed',
				'scene': this,
				'images': images
			});
		}
	};

	add360Images(images){
		this.images360.push(images);
		this.scene.add(images.node);

		this.dispatchEvent({
			'type': '360_images_added',
			'scene': this,
			'images': images
		});
	}

	remove360Images(images){
		let index = this.images360.indexOf(images);
		if (index > -1) {
			this.images360.splice(index, 1);

			this.dispatchEvent({
				'type': '360_images_removed',
				'scene': this,
				'images': images
			});
		}
	}

	addGeopackage(geopackage){
		this.geopackages.push(geopackage);
		this.scene.add(geopackage.node);

		this.dispatchEvent({
			'type': 'geopackage_added',
			'scene': this,
			'geopackage': geopackage
		});
	};

	removeGeopackage(geopackage){
		let index = this.geopackages.indexOf(geopackage);
		if (index > -1) {
			this.geopackages.splice(index, 1);

			this.dispatchEvent({
				'type': 'geopackage_removed',
				'scene': this,
				'geopackage': geopackage
			});
		}
	};

	removeVolume (volume) {
		let index = this.volumes.indexOf(volume);
		if (index > -1) {
			this.volumes.splice(index, 1);

			this.dispatchEvent({
				'type': 'volume_removed',
				'scene': this,
				'volume': volume
			});
		}
	};

	addCameraAnimation(animation) {
		this.cameraAnimations.push(animation);
		this.dispatchEvent({
			'type': 'camera_animation_added',
			'scene': this,
			'animation': animation
		});
	};

	removeCameraAnimation(animation){
		let index = this.cameraAnimations.indexOf(volume);
		if (index > -1) {
			this.cameraAnimations.splice(index, 1);

			this.dispatchEvent({
				'type': 'camera_animation_removed',
				'scene': this,
				'animation': animation
			});
		}
	};

	addPolygonClipVolume(volume){
		this.polygonClipVolumes.push(volume);
		this.dispatchEvent({
			"type": "polygon_clip_volume_added",
			"scene": this,
			"volume": volume
		});
	};
	
	removePolygonClipVolume(volume){
		let index = this.polygonClipVolumes.indexOf(volume);
		if (index > -1) {
			this.polygonClipVolumes.splice(index, 1);
			this.dispatchEvent({
				"type": "polygon_clip_volume_removed",
				"scene": this,
				"volume": volume
			});
		}
	};
	
	addMeasurement(measurement){
		measurement.lengthUnit = this.lengthUnit;
		measurement.lengthUnitDisplay = this.lengthUnitDisplay;
		this.measurements.push(measurement);
		this.dispatchEvent({
			'type': 'measurement_added',
			'scene': this,
			'measurement': measurement
		});
	};

	removeMeasurement (measurement) {
		let index = this.measurements.indexOf(measurement);
		if (index > -1) {
			this.measurements.splice(index, 1);
			this.dispatchEvent({
				'type': 'measurement_removed',
				'scene': this,
				'measurement': measurement
			});
		}
	}

	addProfile (profile) {
		this.profiles.push(profile);
		this.dispatchEvent({
			'type': 'profile_added',
			'scene': this,
			'profile': profile
		});
	}

	removeProfile (profile) {
		let index = this.profiles.indexOf(profile);
		if (index > -1) {
			this.profiles.splice(index, 1);
			this.dispatchEvent({
				'type': 'profile_removed',
				'scene': this,
				'profile': profile
			});
		}
	}

	removeAllMeasurements () {
		while (this.measurements.length > 0) {
			this.removeMeasurement(this.measurements[0]);
		}

		while (this.profiles.length > 0) {
			this.removeProfile(this.profiles[0]);
		}

		while (this.volumes.length > 0) {
			this.removeVolume(this.volumes[0]);
		}
	}

	removeAllClipVolumes(){
		let clipVolumes = this.volumes.filter(volume => volume.clip === true);
		for(let clipVolume of clipVolumes){
			this.removeVolume(clipVolume);
		}

		while(this.polygonClipVolumes.length > 0){
			this.removePolygonClipVolume(this.polygonClipVolumes[0]);
		}
	}

	getActiveCamera() {

		if(this.overrideCamera){
			return this.overrideCamera;
		}

		if(this.cameraMode === CameraMode.PERSPECTIVE){
			return this.cameraP;
		}else if(this.cameraMode === CameraMode.ORTHOGRAPHIC){
			return this.cameraO;
		}else if(this.cameraMode === CameraMode.VR){
			return this.cameraVR;
		}

		return null;
	}
	
	initialize(){
		
		this.referenceFrame = new THREE.Object3D();
		this.referenceFrame.matrixAutoUpdate = false;
		this.scenePointCloud.add(this.referenceFrame);

		this.cameraP.up.set(0, 0, 1);
		this.cameraP.position.set(1000, 1000, 1000);
		this.cameraO.up.set(0, 0, 1);
		this.cameraO.position.set(1000, 1000, 1000);
		//this.camera.rotation.y = -Math.PI / 4;
		//this.camera.rotation.x = -Math.PI / 6;
		this.cameraScreenSpace.lookAt(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0));
		
		this.directionalLight = new THREE.DirectionalLight( 0xffffff, 0.5 );
		this.directionalLight.position.set( 10, 10, 10 );
		this.directionalLight.lookAt( new THREE.Vector3(0, 0, 0));
		this.scenePointCloud.add( this.directionalLight );
		
		let light = new THREE.AmbientLight( 0x555555 ); // soft white light
		this.scenePointCloud.add( light );

		{ // background
			let texture = Utils.createBackgroundTexture(512, 512);

			texture.minFilter = texture.magFilter = THREE.NearestFilter;
			texture.minFilter = texture.magFilter = THREE.LinearFilter;
			let bg = new THREE.Mesh(
				new THREE.PlaneBufferGeometry(2, 2, 1),
				new THREE.MeshBasicMaterial({
					map: texture
				})
			);
			bg.material.depthTest = false;
			bg.material.depthWrite = false;
			this.sceneBG.add(bg);
		}

		// { // lights
		// 	{
		// 		let light = new THREE.DirectionalLight(0xffffff);
		// 		light.position.set(10, 10, 1);
		// 		light.target.position.set(0, 0, 0);
		// 		this.scene.add(light);
		// 	}

		// 	{
		// 		let light = new THREE.DirectionalLight(0xffffff);
		// 		light.position.set(-10, 10, 1);
		// 		light.target.position.set(0, 0, 0);
		// 		this.scene.add(light);
		// 	}

		// 	{
		// 		let light = new THREE.DirectionalLight(0xffffff);
		// 		light.position.set(0, -10, 20);
		// 		light.target.position.set(0, 0, 0);
		// 		this.scene.add(light);
		// 	}
		// }
	}
	
	addAnnotation(position, args = {}){		
		if(position instanceof Array){
			args.position = new THREE.Vector3().fromArray(position);
		} else if (position.x != null) {
			args.position = position;
		}
		let annotation = new Annotation(args);
		this.annotations.add(annotation);

		return annotation;
	}

	getAnnotations () {
		return this.annotations;
	};

	removeAnnotation(annotationToRemove) {
		this.annotations.remove(annotationToRemove);
	}
};
